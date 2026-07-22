// The deterministic core of `deploy plan` (roadmap I.3, ADR 0009). Pure — no DB,
// no network — so it's fully unit-testable.
//
//  (a) validateGraph: is the DESIRED state (graph.yaml) internally coherent?
//      Referential integrity + the owner⇒unscoped invariant (ADR 0008). Authoring
//      bugs, caught before any deploy. NOTE: purpose.tools is intentionally NOT
//      checked against toolCatalog — tool refs are free strings (the catalog is a
//      partial "tools we actually run" registry), so validating them would false-fail.
//
//  (b) planGraph: drift between DESIRED (yaml) and CURRENT (Surreal), field-level,
//      per resource kind. Arrays that are semantically sets diff as sets (order-blind);
//      command args diff as a sequence (order matters). This is the plan `apply` (I.4)
//      would execute.

import { createHash } from "node:crypto";
import type { Definition, User } from "../provider/types.ts";
import { BUCKET_ID, RESERVED_TABLES, SURREAL_IDENT } from "./domain.ts";
import { agentRefString } from "./records.ts";

/** Short content fingerprint for plan rendering — the reviewable full diff is the
 *  tenant-repo PR; the plan only needs to prove drift, one line per change. */
function hash8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

/** A normalized graph state: the definition + users + the responsible edges, flat. */
export interface Edge {
  user: string;
  purpose: string;
  scope?: string;
  role: "owner" | "member";
}
export interface GraphState {
  def: Definition;
  users: Record<string, { name: string; github?: string }>;
  edges: Edge[];
}

/** Build the desired state from a parsed graph.yaml (def + users-with-assignments). */
export function desiredState(def: Definition, users: Record<string, User>): GraphState {
  const edges: Edge[] = [];
  const us: GraphState["users"] = {};
  for (const u of Object.values(users)) {
    us[u.id] = { name: u.name, ...(u.github !== undefined ? { github: u.github } : {}) };
    for (const a of u.assignments) {
      edges.push({ user: u.id, purpose: a.purpose, ...(a.scope !== undefined ? { scope: a.scope } : {}), role: a.role });
    }
  }
  return { def, users: us, edges };
}

// ─── validation (a) ────────────────────────────────────────────────────────

export function validateGraph(def: Definition, users: Record<string, User>): string[] {
  const errors: string[] = [];
  const purposeIds = new Set(def.purposes.map((p) => p.id));
  const bucketIds = new Set(def.buckets.map((b) => b.id));
  const skillNames = new Set(Object.keys(def.skillCatalog));
  const marketplaceNames = new Set(Object.keys(def.marketplaces));

  // duplicate ids
  dupes(def.purposes.map((p) => p.id)).forEach((id) => errors.push(`duplicate purpose: "${id}"`));
  dupes(def.buckets.map((b) => b.id)).forEach((id) => errors.push(`duplicate bucket: "${id}"`));

  for (const p of def.purposes) {
    if (p.parent !== null && !purposeIds.has(p.parent)) errors.push(`purpose "${p.id}": parent "${p.parent}" does not exist`);
    for (const b of p.owns) if (!bucketIds.has(b)) errors.push(`purpose "${p.id}": owns bucket "${b}" does not exist`);
    for (const b of p.reads) if (!bucketIds.has(b)) errors.push(`purpose "${p.id}": reads bucket "${b}" does not exist`);
    for (const s of p.skills) if (!skillNames.has(s)) errors.push(`purpose "${p.id}": skill "${s}" not in catalog and no library/skills/${s}/SKILL.md`);
  }
  for (const s of def.ambient.skills) if (!skillNames.has(s)) errors.push(`ambient: skill "${s}" not in catalog and no library/skills/${s}/SKILL.md`);
  for (const b of def.buckets) if (!purposeIds.has(b.owner)) errors.push(`bucket "${b.id}": owner "${b.owner}" does not exist`);

  // surreal buckets feed the domain-schema GENERATOR (ADR 0011) — their names are
  // interpolated into DDL, so they must be safe identifiers, unique, and non-reserved.
  const tableOwner = new Map<string, string>();
  for (const b of def.buckets) {
    if (b.backend !== "surreal") continue;
    if (!BUCKET_ID.test(b.id)) errors.push(`bucket "${b.id}": id is not a safe slug (letters, digits, _ or -)`);
    if (b.rowScope !== undefined && !SURREAL_IDENT.test(b.rowScope))
      errors.push(`bucket "${b.id}": rowScope "${b.rowScope}" is not a safe identifier (letters, digits, _)`);
    for (const t of b.tables ?? []) {
      if (!SURREAL_IDENT.test(t)) errors.push(`bucket "${b.id}": table "${t}" is not a safe identifier (letters, digits, _)`);
      if (RESERVED_TABLES.has(t)) errors.push(`bucket "${b.id}": table "${t}" is reserved (engine table)`);
      const other = tableOwner.get(t);
      if (other) errors.push(`table "${t}" is declared by two buckets ("${other}" and "${b.id}") — one table, one bucket`);
      else tableOwner.set(t, b.id);
    }
  }

  // decision domains (ADR 0013): interpolated ⟨escaped⟩ as decision_domain record ids
  // and resolved to ONE owning purpose — the log's read authorization rides its lineage.
  const domainOwner = new Map<string, string>();
  for (const p of def.purposes) {
    for (const d of p.decides) {
      if (!BUCKET_ID.test(d)) errors.push(`purpose "${p.id}": decision domain "${d}" is not a safe slug (letters, digits, _ or -)`);
      const other = domainOwner.get(d);
      if (other) errors.push(`decision domain "${d}" is declared by two purposes ("${other}" and "${p.id}") — one domain, one purpose`);
      else domainOwner.set(d, p.id);
    }
  }

  // decision records: the folder (= domain) must be a declared decides: entry, the
  // slug a safe record id, and a supersedes link must point at a real record.
  const decisionIds = new Set(Object.keys(def.decisionCatalog ?? {}));
  for (const [id, d] of Object.entries(def.decisionCatalog ?? {})) {
    const slug = id.slice(d.domain.length + 1);
    if (!BUCKET_ID.test(slug)) errors.push(`decision "${id}": slug is not safe (letters, digits, _ or -)`);
    if (!domainOwner.has(d.domain)) errors.push(`decision "${id}": domain "${d.domain}" is not declared by any purpose (decides:)`);
    if (d.supersedes && !decisionIds.has(d.supersedes)) errors.push(`decision "${id}": supersedes "${d.supersedes}" does not exist`);
  }

  // tool kinds (zod refines authored graphs; re-asserted for synthetic Definitions)
  for (const [name, t] of Object.entries(def.toolCatalog)) {
    if (t.kind === "stdio" && !t.command) errors.push(`tool "${name}": kind stdio requires command`);
    if (t.kind !== "stdio" && !t.url) errors.push(`tool "${name}": kind ${t.kind} requires url`);
  }

  for (const [name, sd] of Object.entries(def.skillCatalog))
    if (sd.source === "plugin" && !marketplaceNames.has(sd.marketplace)) errors.push(`skill "${name}": marketplace "${sd.marketplace}" not registered`);
  for (const [pid, sd] of Object.entries(def.agentByPurpose)) {
    if (!purposeIds.has(pid)) errors.push(`agent of "${pid}": purpose does not exist`);
    if (sd.source === "plugin" && !marketplaceNames.has(sd.marketplace)) errors.push(`agent of "${pid}": marketplace "${sd.marketplace}" not registered`);
    if (sd.source === "library" && sd.content === undefined) errors.push(`agent of "${pid}": no library/agents/${sd.name}.md`);
  }

  for (const u of Object.values(users)) {
    for (const a of u.assignments) {
      if (!purposeIds.has(a.purpose)) errors.push(`user "${u.id}": assigned to nonexistent purpose "${a.purpose}"`);
      // ADR 0008: an owner is accountable for the WHOLE purpose — an owner edge can't be scoped.
      if (a.role === "owner" && a.scope) errors.push(`user "${u.id}": owner of "${a.purpose}" with scope "${a.scope}" (an owner has no scope — create a sub-purpose, ADR 0008)`);
    }
  }
  return errors;
}

// ─── plan (b) ──────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  from?: string;
  to?: string;
  added?: string[];
  removed?: string[];
}
export interface ResourceUpdate {
  kind: string;
  id: string;
  changes: FieldChange[];
}
export interface GraphPlan {
  create: { kind: string; id: string }[];
  delete: { kind: string; id: string }[];
  update: ResourceUpdate[];
  /** advisory notes (never gate the apply) — e.g. an accepted decision being edited */
  warnings: string[];
}

export function planGraph(desired: GraphState, current: GraphState): GraphPlan {
  const plan: GraphPlan = { create: [], delete: [], update: [], warnings: [] };

  const agentRef = (st: GraphState, id: string): string | undefined => agentRefString(st.def.agentByPurpose[id]);

  // purposes
  diffKind(plan, "purpose", byId(desired.def.purposes), byId(current.def.purposes), (d, c, id) => [
    scalar("reason", d.reason, c.reason),
    scalar("parent", d.parent ?? "∅", c.parent ?? "∅"),
    scalar("agent", agentRef(desired, id) ?? "∅", agentRef(current, id) ?? "∅"),
    set("decides", d.decides, c.decides),
    set("owns", d.owns, c.owns),
    set("reads", d.reads, c.reads),
    set("skills", d.skills, c.skills),
    set("tools", d.tools, c.tools),
  ]);

  // buckets
  diffKind(plan, "bucket", byId(desired.def.buckets), byId(current.def.buckets), (d, c) => [
    scalar("backend", d.backend, c.backend),
    scalar("repo", d.repo ?? "∅", c.repo ?? "∅"),
    scalar("owner", d.owner, c.owner),
    scalar("rowScope", d.rowScope ?? "∅", c.rowScope ?? "∅"),
    scalar("sens", d.sens, c.sens),
    set("tables", d.tables ?? [], c.tables ?? []),
  ]);

  // tools (args ordered → sequence; env object → per-key)
  diffKind(plan, "tool", asMap(desired.def.toolCatalog), asMap(current.def.toolCatalog), (d, c) => [
    scalar("kind", d.kind, c.kind),
    scalar("command", d.command ?? "∅", c.command ?? "∅"),
    scalar("url", d.url ?? "∅", c.url ?? "∅"),
    scalar("keySource", d.keySource, c.keySource),
    scalar("args", d.args.join(" "), c.args.join(" ")),
    scalar("env", envStr(d.env), envStr(c.env)),
  ]);

  // skills: source scalar + per-variant fields. Library files diff as a name-set
  // plus a hash scalar per changed file (never full text — the PR is the review).
  diffKind(plan, "skill", asMap(desired.def.skillCatalog), asMap(current.def.skillCatalog), (d, c) => {
    const changes: (FieldChange | null)[] = [scalar("source", d.source, c.source)];
    if (d.source === "plugin" && c.source === "plugin") {
      changes.push(scalar("plugin", d.plugin, c.plugin), scalar("marketplace", d.marketplace, c.marketplace));
    } else if (d.source === "library" && c.source === "library") {
      changes.push(set("files", Object.keys(d.files), Object.keys(c.files)));
      for (const k of Object.keys(d.files)) {
        if (k in c.files && d.files[k] !== c.files[k]) changes.push(scalar(`files.${k}`, hash8(d.files[k]!), hash8(c.files[k]!)));
      }
    }
    return changes;
  });
  diffKind(plan, "marketplace", strMap(desired.def.marketplaces), strMap(current.def.marketplaces), (d, c) => [
    scalar("repo", d, c),
  ]);

  // decision records (ADR 0013): content as a hash scalar; an ACCEPTED record whose
  // content changed is jurisprudence being rewritten — warn (supersede is the way).
  diffKind(plan, "decision", asMap(desired.def.decisionCatalog ?? {}), asMap(current.def.decisionCatalog ?? {}), (d, c, id) => {
    if (c.status === "accepted" && d.content !== c.content) {
      plan.warnings.push(`decision "${id}" is accepted (immutable) — supersede it instead of editing`);
    }
    return [
      scalar("domain", d.domain, c.domain),
      scalar("status", d.status, c.status),
      scalar("title", d.title, c.title),
      scalar("supersedes", d.supersedes ?? "∅", c.supersedes ?? "∅"),
      scalar("at", d.at ?? "∅", c.at ?? "∅"),
      scalar("content", hash8(d.content), hash8(c.content)),
    ];
  });

  // library agent content (deduped by name; the purpose-level ref diffs above)
  diffKind(plan, "agent", libraryAgents(desired), libraryAgents(current), (d, c) => [
    scalar("content", hash8(d), hash8(c)),
  ]);

  // config singleton: ambient skills (set)
  const ambChange = set("skills", desired.def.ambient.skills, current.def.ambient.skills);
  if (ambChange) plan.update.push({ kind: "config", id: "ambient", changes: [ambChange] });

  // users (name, github)
  diffKind(plan, "user", strMap2(desired.users), strMap2(current.users), (d, c) => [
    scalar("name", d.name, c.name),
    scalar("github", d.github ?? "∅", c.github ?? "∅"),
  ]);

  // responsible edges (key = user|purpose|scope; role is the field)
  const edgeKey = (e: Edge) => `${e.user}|${e.purpose}|${e.scope ?? ""}`;
  const edgeLabel = (e: Edge) => `${e.user}→${e.purpose}${e.scope ? `[${e.scope}]` : ""}`;
  const dEdges = new Map(desired.edges.map((e) => [edgeKey(e), e]));
  const cEdges = new Map(current.edges.map((e) => [edgeKey(e), e]));
  for (const [k, e] of dEdges) {
    const cur = cEdges.get(k);
    if (!cur) plan.create.push({ kind: "responsible", id: edgeLabel(e) });
    else {
      const ch = scalar("role", e.role, cur.role);
      if (ch) plan.update.push({ kind: "responsible", id: edgeLabel(e), changes: [ch] });
    }
  }
  for (const [k, e] of cEdges) if (!dEdges.has(k)) plan.delete.push({ kind: "responsible", id: edgeLabel(e) });

  return plan;
}

export function planIsEmpty(p: GraphPlan): boolean {
  return p.create.length === 0 && p.delete.length === 0 && p.update.length === 0;
}

/** Structured responsible-edge delta (keyed by user|purpose|scope). Apply consumes
 *  this directly — no re-parsing of the display labels planGraph emits. */
export interface EdgeDelta {
  added: Edge[];
  removed: Edge[];
  roleChanged: { edge: Edge; from: Edge["role"]; to: Edge["role"] }[];
}
export function edgeDelta(desired: GraphState, current: GraphState): EdgeDelta {
  const key = (e: Edge) => `${e.user}|${e.purpose}|${e.scope ?? ""}`;
  const d = new Map(desired.edges.map((e) => [key(e), e]));
  const c = new Map(current.edges.map((e) => [key(e), e]));
  const out: EdgeDelta = { added: [], removed: [], roleChanged: [] };
  for (const [k, e] of d) {
    const cur = c.get(k);
    if (!cur) out.added.push(e);
    else if (cur.role !== e.role) out.roleChanged.push({ edge: e, from: cur.role, to: e.role });
  }
  for (const [k, e] of c) if (!d.has(k)) out.removed.push(e);
  return out;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function diffKind<T>(
  plan: GraphPlan,
  kind: string,
  desired: Map<string, T>,
  current: Map<string, T>,
  fields: (d: T, c: T, id: string) => (FieldChange | null)[],
): void {
  for (const [id, d] of desired) {
    const c = current.get(id);
    if (!c) plan.create.push({ kind, id });
    else {
      const changes = fields(d, c, id).filter((x): x is FieldChange => x !== null);
      if (changes.length) plan.update.push({ kind, id, changes });
    }
  }
  for (const [id] of current) if (!desired.has(id)) plan.delete.push({ kind, id });
}

// Both scalar() and set() take (desired, current). A plan reads current → desired
// (what IS → what it will BECOME), so `from` is current and `to` is desired.
function scalar(field: string, desired: string, current: string): FieldChange | null {
  return desired === current ? null : { field, from: current, to: desired };
}

function set(field: string, desired: string[], current: string[]): FieldChange | null {
  const d = new Set(desired);
  const c = new Set(current);
  const added = desired.filter((x) => !c.has(x));
  const removed = current.filter((x) => !d.has(x));
  return added.length || removed.length ? { field, ...(added.length ? { added } : {}), ...(removed.length ? { removed } : {}) } : null;
}

function envStr(env: Record<string, string>): string {
  return Object.keys(env).sort().map((k) => `${k}=${env[k]}`).join(",");
}

function byId<T extends { id: string }>(arr: T[]): Map<string, T> {
  return new Map(arr.map((x) => [x.id, x]));
}
/** Distinct library agents (name -> content) in a state — the `agent` table's rows. */
function libraryAgents(st: GraphState): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of Object.values(st.def.agentByPurpose)) {
    if (a.source === "library" && a.content !== undefined) m.set(a.name, a.content);
  }
  return m;
}
function asMap<T>(rec: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(rec));
}
function strMap(rec: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(rec));
}
function strMap2(rec: Record<string, { name: string; github?: string }>): Map<string, { name: string; github?: string }> {
  return new Map(Object.entries(rec));
}
function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}
