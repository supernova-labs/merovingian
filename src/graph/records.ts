// Pure record-builders: a Definition → the Surreal record docs for each structural
// table. Extracted from reset's projectInto so reset (wipe) and deploy apply
// (converge) share ONE source of truth for record shapes — the round-trip test pins
// their output. `compact()` (drop undefined → NONE) is part of the builder contract,
// so callers can hand the content straight to `.content()` without re-compacting.

import { RecordId } from "surrealdb";
import type { AgentRef, Bucket, DecisionDef, Definition, Purpose, SkillRef, ToolDef, User } from "../provider/types.ts";

/** Drop keys whose value is undefined (they become NONE on write). */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

export interface RecordDoc {
  recordId: RecordId;
  content: Record<string, unknown>;
}

/** Denormalized lineage [self, parent, ..., root] per purpose id (computed in TS,
 *  as the data-access permission checks ancestry flat). */
export function lineageOf(purposes: Purpose[]): Map<string, string[]> {
  const byId = new Map(purposes.map((p) => [p.id, p]));
  const memo = new Map<string, string[]>();
  const chain = (id: string): string[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    const out: string[] = [];
    let cur: string | null = id;
    while (cur) {
      out.push(cur);
      cur = byId.get(cur)?.parent ?? null;
    }
    memo.set(id, out);
    return out;
  };
  return new Map(purposes.map((p) => [p.id, chain(p.id)]));
}

export function toolDoc(name: string, t: ToolDef): RecordDoc {
  return { recordId: new RecordId("tool", name), content: compact({ kind: t.kind, command: t.command, args: t.args, env: t.env, keySource: t.keySource, url: t.url }) };
}

export function marketplaceDoc(name: string, repo: string): RecordDoc {
  return { recordId: new RecordId("marketplace", name), content: { repo } };
}

export function skillDoc(name: string, s: SkillRef): RecordDoc {
  const content =
    s.source === "plugin"
      ? { source: "plugin", plugin: s.plugin, marketplace: new RecordId("marketplace", s.marketplace) }
      : { source: "library", files: s.files };
  return { recordId: new RecordId("skill", name), content };
}

/** A library agent's content record (one per DISTINCT agent name — deduped). */
export function agentDoc(name: string, content: string): RecordDoc {
  return { recordId: new RecordId("agent", name), content: { content } };
}

/** A ratified decision record (ADR 0013) — id is "<domain>/<slug>" (⟨⟩-escaped by
 *  the driver). `at` ships as a real datetime; supersedes as a record link. */
export function decisionDoc(id: string, d: DecisionDef): RecordDoc {
  return {
    recordId: new RecordId("decision", id),
    content: compact({
      domain: d.domain,
      status: d.status,
      title: d.title,
      content: d.content,
      supersedes: d.supersedes ? new RecordId("decision", d.supersedes) : undefined,
      at: d.at ? new Date(d.at) : undefined,
    }),
  };
}

/** The authored ref string a purpose record stores: `name` (library) or
 *  `plugin@marketplace` (external). "@" is the discriminator on read-back. */
export function agentRefString(a: AgentRef | undefined): string | undefined {
  if (!a) return undefined;
  return a.source === "library" ? a.name : `${a.plugin}@${a.marketplace}`;
}

/** The config singleton — keyed on the NAMESPACE (not "ambient"). */
export function configDoc(namespace: string, ambient: string[]): RecordDoc {
  return { recordId: new RecordId("config", namespace), content: { ambient } };
}

export function bucketDoc(b: Bucket): RecordDoc {
  return {
    recordId: new RecordId("bucket", b.id),
    content: compact({
      backend: b.backend,
      repo: b.repo,
      tables: b.tables ?? [],
      owner: new RecordId("purpose", b.owner),
      rowScope: b.rowScope,
      sens: b.sens,
    }),
  };
}

export function purposeDoc(p: Purpose, agent: AgentRef | undefined, lineageIds: string[]): RecordDoc {
  return {
    recordId: new RecordId("purpose", p.id),
    content: compact({
      reason: p.reason,
      parent: p.parent ? new RecordId("purpose", p.parent) : undefined,
      decides: p.decides,
      owns: p.owns.map((b) => new RecordId("bucket", b)),
      reads: p.reads.map((b) => new RecordId("bucket", b)),
      skills: p.skills,
      tools: p.tools,
      agent: agentRefString(agent),
      lineage: lineageIds.map((x) => new RecordId("purpose", x)),
    }),
  };
}

export function userDoc(u: User): RecordDoc {
  return { recordId: new RecordId("user", u.id), content: compact({ name: u.name, github: u.github }) };
}

/** Every structural record for a Definition + users (NO responsible edges — those
 *  are reconciled separately). Order is irrelevant (upsert by id, no FK enforcement). */
export function structuralRecords(def: Definition, users: Record<string, User>): RecordDoc[] {
  const docs: RecordDoc[] = [];
  for (const [name, t] of Object.entries(def.toolCatalog)) docs.push(toolDoc(name, t));
  for (const [name, repo] of Object.entries(def.marketplaces)) docs.push(marketplaceDoc(name, repo));
  for (const [name, s] of Object.entries(def.skillCatalog)) docs.push(skillDoc(name, s));
  for (const [id, d] of Object.entries(def.decisionCatalog ?? {})) docs.push(decisionDoc(id, d));
  docs.push(configDoc(def.namespace, def.ambient.skills));
  for (const b of def.buckets) docs.push(bucketDoc(b));
  const lin = lineageOf(def.purposes);
  for (const p of def.purposes) docs.push(purposeDoc(p, def.agentByPurpose[p.id], lin.get(p.id) ?? [p.id]));
  // library agent content — one record per DISTINCT name (several purposes may share
  // an agent). Unresolved content (undefined) never gets here: applyGraph validates first.
  const agentContent = new Map<string, string>();
  for (const a of Object.values(def.agentByPurpose)) {
    if (a.source === "library" && a.content !== undefined) agentContent.set(a.name, a.content);
  }
  for (const [name, content] of agentContent) docs.push(agentDoc(name, content));
  for (const u of Object.values(users)) docs.push(userDoc(u));
  return docs;
}
