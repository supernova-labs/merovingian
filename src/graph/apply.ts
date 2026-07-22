// The deterministic apply (roadmap I.4, ADR 0009 §3). Converges Surreal toward the
// desired graph.yaml — structure-only, idempotent, referrer-safe on delete, never
// touching business data. ONE orchestration serves both:
//   • reset    = applyGraph(reset:true)  — wipe structural + project (dev/test reset)
//   • deploy apply = applyGraph(reset:false) — surgical converge (prod/governance)
//
// Order (apply mode): validate → ensure schema → read current → plan → [--yes gate]
// → [pre-flight referrer-check, atomic] → upsert desired → reconcile edges → delete.
//
// Atomicity without a transaction: apply never touches runtime tables, so a runtime
// referrer (inbox.user) reads identically before/after the upsert; and validateGraph
// guarantees no surviving structural record references a deleted one. So the referrer
// check is accurate PRE-WRITE → abort-before-writing is atomic, zero partial state.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RecordId, Table, type Surreal } from "surrealdb";
import { SurrealProvider } from "../provider/surreal.ts";
import type { Definition, User } from "../provider/types.ts";
import { domainSchema } from "./domain.ts";
import { structuralRecords, compact } from "./records.ts";
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

/** Read the current graph out of Surreal; an unmigrated namespace reads as empty. */
export async function readCurrentState(db: Surreal, namespace: string): Promise<GraphState> {
  const provider = new SurrealProvider(db, namespace);
  let def: Definition;
  try {
    def = await provider.getDefinition();
  } catch (e) {
    // fresh/unmigrated db: config empty ("not migrated") OR the schema tables don't exist
    // yet ("does not exist"). Either way the current state is empty → all-create.
    if (e instanceof Error && (e.message.includes("not migrated") || e.message.includes("does not exist"))) {
      return { def: emptyDefinition(namespace), users: {}, edges: [] };
    }
    throw e;
  }
  const asg = await provider.listAssignments();
  const users: GraphState["users"] = {};
  const edges: Edge[] = [];
  for (const r of asg) {
    users[r.user.id] = { name: r.user.name, ...(r.user.github !== undefined ? { github: r.user.github } : {}) };
    edges.push({ user: r.user.id, purpose: r.purpose, ...(r.scope !== undefined ? { scope: r.scope } : {}), role: r.role });
  }
  return { def, users, edges };
}

// ─── runtime referrer registry ───────────────────────────────────────────
// Structural referrers are provably clean (validate + upsert-before-delete), so the
// only referrers that can BLOCK a delete are live runtime rows pointing at a record.
// Today: inbox.user → user. Future runtime FKs are one entry each.

interface RuntimeRef {
  table: string;
  field: string;
  targetKind: string;
  /** the field is an array of record links (CONTAINS instead of =) */
  array?: boolean;
}
const RUNTIME_REFERRERS: Record<string, RuntimeRef[]> = {
  user: [{ table: "inbox", field: "user", targetKind: "user" }],
  // a decision_log citing a record blocks its deletion — cited jurisprudence
  // never vanishes silently (ADR 0013).
  decision: [{ table: "decision_log", field: "records", targetKind: "decision", array: true }],
};

/** ADR 0014: a deleted purpose's scoped frictions fall to the nearest SURVIVING
 *  ancestor (gravity, ADR 0008) — or back to the root queue (scope = NONE) when the
 *  whole line goes. Runtime data never blocks a structural purpose delete. */
async function rescopeOrphanedFrictions(
  db: Surreal,
  current: GraphState,
  recordDeletes: { kind: string; id: string }[],
): Promise<void> {
  const deleted = new Set(recordDeletes.filter((d) => d.kind === "purpose").map((d) => d.id));
  if (!deleted.size) return;
  const parentOf = new Map(current.def.purposes.map((p) => [p.id, p.parent]));
  for (const id of deleted) {
    let anc = parentOf.get(id) ?? null;
    while (anc && deleted.has(anc)) anc = parentOf.get(anc) ?? null;
    await db.query(
      anc
        ? `UPDATE inbox SET scope = type::record("purpose", $anc) WHERE scope = type::record("purpose", $id)`
        : `UPDATE inbox SET scope = NONE WHERE scope = type::record("purpose", $id)`,
      anc ? { anc, id } : { id },
    );
  }
}

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

/** Engine runtime schema (identity access + inbox) — idempotent OVERWRITE, safe to
 *  re-apply standalone (the inbox drain does, before stamping: SCHEMAFULL silently
 *  drops writes to a field an older db hasn't defined yet). */
export async function ensureDataSchema(db: Surreal): Promise<void> {
  await db.query(await readFile(DATA_SCHEMA_PATH, "utf8"));
}

async function ensureSchema(db: Surreal): Promise<void> {
  await db.query(await readFile(SCHEMA_PATH, "utf8"));
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

/** Reconcile the decision_domain lookup (ADR 0013): domain → owning purpose, derived
 *  from purpose.decides. It is LIVE AUTHORIZATION (decision_log permissions dot-access
 *  it), so staleness matters both ways: upsert every declared domain, DELETE every row
 *  whose domain is no longer declared. Runs in both modes, after upsertRecords. */
export async function reconcileDecisionDomains(db: Surreal, def: Definition): Promise<void> {
  const declared: string[] = [];
  for (const p of def.purposes) {
    for (const d of p.decides) {
      declared.push(d);
      await db.upsert(new RecordId("decision_domain", d)).content({ owner: new RecordId("purpose", p.id) });
    }
  }
  await db.query("DELETE decision_domain WHERE record::id(id) NOTINSIDE $domains", { domains: declared });
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

export async function applyGraph(db: Surreal, definition: Definition, users: Record<string, User>, opts: ApplyOpts = {}): Promise<ApplyReport> {
  const errors = validateGraph(definition, users);
  if (errors.length) throw new GraphValidationError(errors);

  await ensureSchema(db);
  await ensureDomainSchema(db, definition);
  const desired = desiredState(definition, users);

  // reset: blunt wipe + project. No plan, no referrer-check, no deletes.
  if (opts.reset) {
    await db.query("DELETE config; DELETE purpose; DELETE bucket; DELETE tool; DELETE marketplace; DELETE skill; DELETE agent; DELETE user; DELETE responsible; DELETE decision_domain; DELETE decision;");
    await upsertRecords(db, definition, users);
    await reconcileDecisionDomains(db, definition);
    await reconcileEdges(db, { added: desired.edges, removed: [], roleChanged: [] });
    return { status: "applied", plan: EMPTY_PLAN, applied: { created: structuralRecords(definition, users).length + desired.edges.length, updated: 0, deleted: 0 } };
  }

  // apply (converge): plan → gates → mutate.
  const current = await readCurrentState(db, definition.namespace);
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
  await reconcileDecisionDomains(db, definition);
  await reconcileEdges(db, edgeDelta(desired, current));
  await rescopeOrphanedFrictions(db, current, recordDeletes);
  for (const d of recordDeletes) await db.delete(new RecordId(d.kind, d.id));

  return { status: "applied", plan, applied: { created: plan.create.length, updated: plan.update.length, deleted: plan.delete.length } };
}
