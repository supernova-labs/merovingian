import { restrictLegacyHistory } from "../history/retire.ts";
// The deterministic apply (roadmap I.4, ADR 0009 §3). Converges Surreal toward the
// desired graph.yaml — structure-only, idempotent, referrer-safe on delete, never
// touching business data. ONE orchestration serves both:
//   • reset    = applyGraph(reset:true)  — wipe structural + project (dev/test reset)
//   • deploy apply = applyGraph(reset:false) — surgical converge (prod/governance)
//
// Order (apply mode): validate → ensure schema → read current → plan → [--yes gate]
// → [pre-flight referrer-check] → upsert desired → reconcile edges → delete.
//
// Referrer checks precede graph writes, but schema preparation and historical
// permission lockdown have already run. This is not a database transaction.
// Immutable journal authors must be retained; remove assignments to offboard.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, RecordId, Table, type Surreal } from "surrealdb";
import { SurrealProvider, provisioningSecret } from "../provider/surreal.ts";
import type { Definition, User } from "../provider/types.ts";
import { domainSchema } from "./domain.ts";
import { structuralRecords, compact, readersOf, ambientFlags, purposeLinks } from "./records.ts";
import {
  desiredState,
  edgeDelta,
  planGraph,
  validateGraph,
  type Edge,
  type GraphPlan,
  type GraphState,
} from "./plan.ts";

const SCHEMA_PATH = join(import.meta.dir, "../../surreal/schema.surql");
const DATA_SCHEMA_PATH = join(import.meta.dir, "../../surreal/data.surql");
const AUTH_SCHEMA_PATH = join(import.meta.dir, "../../surreal/auth.surql");

export class GraphValidationError extends Error {
  constructor(public errors: string[]) {
    super(`invalid graph: ${errors.length} authoring error(s)`);
    this.name = "GraphValidationError";
  }
}

export type ApplyStatus = "applied" | "needs-confirm" | "blocked";
export interface Blocked {
  kind: string;
  id: string;
  referrers: string[];
}
export interface ApplyReport {
  status: ApplyStatus;
  plan: GraphPlan;
  applied?: { created: number; updated: number; deleted: number };
  blocked?: Blocked[];
}

const EMPTY_PLAN: GraphPlan = { create: [], delete: [], update: [], warnings: [] };

export function emptyDefinition(namespace: string): Definition {
  return { namespace, ambient: { skills: [] }, purposes: [], buckets: [], toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {} };
}

const STRUCTURAL_TABLES = ["config", "purpose", "bucket", "tool", "marketplace", "skill", "agent", "user", "responsible"] as const;
const HISTORY_TABLES = ["credential", "journal", "inbox", "decision", "decision_log", "decision_domain"] as const;

/** Administrative, read-only inspection. Never interpret a failed read as empty state. */
export async function readCurrentState(db: Surreal, namespace: string): Promise<GraphState> {
  const empty = (): GraphState => ({ def: emptyDefinition(namespace), users: {}, edges: [], configExists: false });
  let tables: Record<string, unknown>;
  try {
    const [info] = await db.query<[{ tables: Record<string, unknown> }]>("INFO FOR DB");
    if (!info?.tables || typeof info.tables !== "object") throw new Error("Unable to inspect database schema; no plan was inferred.");
    tables = info.tables;
  } catch (e) {
    // Only an explicitly absent database/namespace is evidence of a virgin target.
    if (e instanceof NotFoundError && (e.databaseName !== undefined || e.namespaceName !== undefined)) return empty();
    throw e;
  }
  const hasConfig = "config" in tables
    ? (await db.query<[unknown[]]>("SELECT id FROM config LIMIT 1"))[0].length > 0
    : false;
  if (!hasConfig) {
    // A schema-only database is safe to initialize; orphaned structure/history is not.
    for (const table of [...STRUCTURAL_TABLES, ...HISTORY_TABLES]) {
      if (!(table in tables)) continue;
      const [rows] = await db.query<[unknown[]]>(`SELECT id FROM ${table} LIMIT 1`);
      if (rows.length) throw new Error(`Incomplete database: config is missing but ${table} contains records. No plan was inferred. Verify the target and restore the missing configuration before deploying.`);
    }
    return empty();
  }
  const missing = STRUCTURAL_TABLES.filter((table) => !(table in tables));
  if (missing.length) throw new Error(`Outdated or incomplete database schema: missing tables ${missing.join(", ")}. No plan was inferred. Verify the target and backup, then run merovingian deploy apply from the tenant repo to prepare the schema; review deletions before using --yes.`);
  const provider = new SurrealProvider(db, namespace);
  const def = await provider.getDefinition();
  const asg = await provider.listAssignments();
  const users: GraphState["users"] = {};
  const edges: Edge[] = [];
  for (const r of asg) {
    users[r.user.id] = { name: r.user.name, ...(r.user.github !== undefined ? { github: r.user.github } : {}), ...(r.user.email !== undefined ? { email: r.user.email } : {}), ...(r.user.slackId !== undefined ? { slackId: r.user.slackId } : {}), ...(r.user.journalAdmin !== undefined ? { journalAdmin: r.user.journalAdmin } : {}) };
    edges.push({ user: r.user.id, purpose: r.purpose, ...(r.scope !== undefined ? { scope: r.scope } : {}), role: r.role });
  }
  return { def, users, edges, configExists: true };
}

// ─── runtime referrer registry ───────────────────────────────────────────
// Structural referrers are provably clean (validate + upsert-before-delete), so the
// only referrers that can BLOCK a delete are live runtime rows pointing at a record.
// Journal authors remain referentially protected.

interface RuntimeRef {
  table: string;
  field: string;
  targetKind: string;
  /** the field is an array of record links (CONTAINS instead of =) */
  array?: boolean;
}
const RUNTIME_REFERRERS: Record<string, RuntimeRef[]> = {
  user: [{ table: "journal", field: "author", targetKind: "user" }],

};

/** Live-query the runtime rows still pointing at a to-be-deleted record. */
export async function referrerCheck(db: Surreal, kind: string, id: string): Promise<string[]> {
  const refs = RUNTIME_REFERRERS[kind] ?? [];
  const out: string[] = [];
  for (const r of refs) {
    // table/field come from the trusted constant above; id is parameterized.
    const cond = r.array ? `${r.field} CONTAINS type::record($k, $id)` : `${r.field} = type::record($k, $id)`;
    const [rows] = await db.query<[{ rid: string }[]]>(
      `SELECT record::id(id) AS rid FROM ${r.table} WHERE ${cond}`,
      { k: r.targetKind, id },
    );
    for (const row of rows) out.push(`${r.table}:${row.rid}`);
  }
  return out;
}

// ─── mutations ─────────────────────────────────────────────────────────────

/** Apply current runtime schema and restrict preserved history; never re-key identity. */
export async function ensureDataSchema(db: Surreal): Promise<void> {
  await db.query(await readFile(DATA_SCHEMA_PATH, "utf8"));
  await restrictLegacyHistory(db);
}

/** The identity DEFINE ACCESS — provisioned ONLY on the apply/reset path (never the
 *  drain). Binds the trusted signing KEY from provisioningSecret: a real tenant gets
 *  the private MEROVINGIAN_JWT_SECRET; dev/test (reset) the public key.
 *
 *  On a converge (non-reset) it is applied ONLY when the access is ABSENT (a virgin db):
 *  a routine `deploy apply` (e.g. adding a user) must never silently re-key a live tenant
 *  with whatever secret the env happens to hold — that would invalidate every outstanding
 *  token. Re-keying is explicit: it happens on `reset` (a dev/test wipe) alone. */
async function ensureAuthSchema(db: Surreal, reset: boolean): Promise<void> {
  if (!reset) {
    const [info] = await db.query<[{ accesses?: Record<string, unknown> }]>("INFO FOR DB");
    if (info?.accesses?.identity) return; // already keyed — leave it (rotate via reset)
  }
  await db.query(await readFile(AUTH_SCHEMA_PATH, "utf8"), { jwt_secret: provisioningSecret(reset) });
}

async function ensureSchema(db: Surreal, reset: boolean): Promise<void> {
  await db.query(await readFile(SCHEMA_PATH, "utf8"));
  await ensureAuthSchema(db, reset);
  await ensureDataSchema(db);
}

/** Generated domain schema (ADR 0011): tables + PERMISSIONS derived from the surreal
 *  buckets. Idempotent OVERWRITE, regenerated on every apply. Never drops. */
async function ensureDomainSchema(db: Surreal, def: Definition): Promise<void> {
  const statements = domainSchema(def);
  if (statements.length) await db.query(statements.join("\n"));
}

/** Upsert (create-or-replace) every desired structural record. Full-content replace
 *  → stale optional fields (e.g. a removed agent) become NONE. */
export async function upsertRecords(db: Surreal, def: Definition, users: Record<string, User>): Promise<void> {
  for (const doc of structuralRecords(def, users)) {
    await db.upsert(doc.recordId).content(doc.content);
  }
}

async function deleteEdge(db: Surreal, e: Edge): Promise<void> {
  // Unscoped edges store scope = NONE — match it explicitly, never scope = "".
  const base = "DELETE responsible WHERE in = type::record('user', $u) AND out = type::record('purpose', $p)";
  if (e.scope === undefined) await db.query(`${base} AND scope = NONE`, { u: e.user, p: e.purpose });
  else await db.query(`${base} AND scope = $s`, { u: e.user, p: e.purpose, s: e.scope });
}

async function relateEdge(db: Surreal, e: Edge): Promise<void> {
  await db.relate<Record<string, unknown>>(
    new RecordId("user", e.user),
    new Table("responsible"),
    new RecordId("purpose", e.purpose),
    compact({ role: e.role, scope: e.scope }),
  );
}

/** Reconcile responsible edges as a delta. relate is only ever called for a key
 *  absent from current (never double-relate); role changes are delete + relate. */
export async function reconcileEdges(db: Surreal, delta: { added: Edge[]; removed: Edge[]; roleChanged: { edge: Edge }[] }): Promise<void> {
  for (const e of delta.removed) await deleteEdge(db, e);
  for (const rc of delta.roleChanged) {
    await deleteEdge(db, rc.edge);
    await relateEdge(db, rc.edge);
  }
  for (const e of delta.added) await relateEdge(db, e);
}

// ─── the orchestration ─────────────────────────────────────────────────────

export interface ApplyOpts {
  reset?: boolean;
  confirmDeletes?: boolean;
}

/** Write the ADR 0016 derived fields (readers/ambient) for the CURRENT state's rows.
 *  Targeted SET updates (never full-content) — safe to run before the plan gates. */
async function backfillDerivedReaders(db: Surreal, def: Definition): Promise<void> {
  const readers = readersOf(def);
  const ambient = ambientFlags(def);
  for (const b of def.buckets) {
    await db.query("UPDATE type::record('bucket', $id) SET readers = $r", { id: b.id, r: purposeLinks(readers.bucket.get(b.id)) });
  }
  for (const name of Object.keys(def.toolCatalog)) {
    await db.query("UPDATE type::record('tool', $id) SET readers = $r", { id: name, r: purposeLinks(readers.tool.get(name)) });
  }
  for (const name of Object.keys(def.skillCatalog)) {
    await db.query("UPDATE type::record('skill', $id) SET readers = $r, ambient = $a", {
      id: name, r: purposeLinks(readers.skill.get(name)), a: ambient.skills.has(name),
    });
  }
  for (const name of Object.keys(def.marketplaces)) {
    await db.query("UPDATE type::record('marketplace', $id) SET readers = $r, ambient = $a", {
      id: name, r: purposeLinks(readers.marketplace.get(name)), a: ambient.marketplaces.has(name),
    });
  }
  const agentNames = new Set<string>();
  for (const a of Object.values(def.agentByPurpose)) if (a.source === "library") agentNames.add(a.name);
  for (const name of agentNames) {
    await db.query("UPDATE type::record('agent', $id) SET readers = $r", { id: name, r: purposeLinks(readers.agent.get(name)) });
  }
}

export async function applyGraph(db: Surreal, definition: Definition, users: Record<string, User>, opts: ApplyOpts = {}): Promise<ApplyReport> {
  const errors = validateGraph(definition, users);
  if (errors.length) throw new GraphValidationError(errors);

  // reset is the dev/test provisioning path (never a live tenant): it alone may fall back
  // to the public dev key and re-key the access. A converge (reset:false) provisions the
  // access only on a virgin db and requires MEROVINGIAN_JWT_SECRET.
  await ensureSchema(db, opts.reset ?? false);
  await ensureDomainSchema(db, definition);
  const desired = desiredState(definition, users);

  // reset: blunt wipe + project. No plan, no referrer-check, no deletes.
  if (opts.reset) {
    await db.query("DELETE config; DELETE purpose; DELETE bucket; DELETE tool; DELETE marketplace; DELETE skill; DELETE agent; DELETE user; DELETE responsible;");
    await upsertRecords(db, definition, users);
    await reconcileEdges(db, { added: desired.edges, removed: [], roleChanged: [] });
    return { status: "applied", plan: EMPTY_PLAN, applied: { created: structuralRecords(definition, users).length + desired.edges.length, updated: 0, deleted: 0 } };
  }

  // apply (converge): plan → gates → mutate.
  const current = await readCurrentState(db, definition.namespace);

  // ADR 0016 migration ordering: ensureSchema (above) turned the lineage SELECT
  // permissions ON — but rows written before the derived fields existed have
  // readers = NONE, i.e. invisible to every member the instant the permissions land.
  // A needs-confirm/blocked return below would leave the db that way indefinitely.
  // Backfill from the CURRENT definition (idempotent; the upsert overwrites with the
  // desired values later) so member reads survive every exit path of this converge.
  await backfillDerivedReaders(db, current.def);

  const plan = planGraph(desired, current);
  const recordDeletes = plan.delete.filter((d) => d.kind !== "responsible");

  // --yes gate: any deletion (record or edge) needs confirmation.
  if (plan.delete.length > 0 && !opts.confirmDeletes) return { status: "needs-confirm", plan };

  // pre-flight referrer-check (record deletes only; edges have no referrers). Atomic:
  // if ANY delete is blocked, abort before writing anything.
  const blocked: Blocked[] = [];
  for (const d of recordDeletes) {
    const referrers = await referrerCheck(db, d.kind, d.id);
    if (referrers.length) blocked.push({ kind: d.kind, id: d.id, referrers });
  }
  if (blocked.length) return { status: "blocked", plan, blocked };

  // mutate: upsert all desired → reconcile edges → delete removed records.
  await upsertRecords(db, definition, users);
  await reconcileEdges(db, edgeDelta(desired, current));
  for (const d of recordDeletes) {
    await db.delete(new RecordId(d.kind, d.id));
    // a removed HUMAN takes their credential along: if the same uid is ever re-created
    // for a different person, the old holder's password must not reactivate. Query
    // DELETE (not db.delete) — idempotent when the user never had a credential.
    if (d.kind === "user") await db.query("DELETE type::record('credential', $u)", { u: d.id });
  }

  return { status: "applied", plan, applied: { created: plan.create.length, updated: plan.update.length, deleted: plan.delete.length } };
}
