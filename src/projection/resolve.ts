// The heart: project the global definition into a scoped manifest for one
// identity. Pure function — no IO — so it is trivially golden-testable and
// source-agnostic (stub today, Surreal later).
//
// Rules (MODELO-v3 + ADR 0002/0004):
//   1. visible purposes = assumed purpose + its descendants in the tree.
//   2. buckets = union of owns ∪ reads across visible purposes.
//   3. okf-repo buckets -> additionalDirectories (path in central store).
//   4. surreal buckets -> .mcp.json placeholder; if the bucket has rowScope AND the
//      assignment carries a scope, stamp env.SCOPE (generation, not enforcement).
//   5. plugins = pluginByPurpose for visible purposes + the ambient plugin.
//   6. tools = union of tools across visible purposes.
//   7. ambient skills (journal/friction) always present (via ambient plugin).
//
// The parent never expands the child: projection starts from the *assumed*
// purpose, never from privilege above it.

import type { Assignment, Bucket, Definition, MarketplaceDef, User } from "../provider/types.ts";
import { repoStore, repoDir } from "../paths.ts";
import { parseSkillMarkdown } from "../graph/skill-content.ts";

export interface OkfMount {
  bucket: string;
  repo: string;
  /** absolute path in the central store -> goes into additionalDirectories */
  path: string;
}

export interface SurrealMount {
  bucket: string;
  tables: string[];
  /** "<rowScope>:<value>" (e.g. "account:north") when scoped; undefined = unscoped */
  scope?: string;
}

/** A library skill carried by the manifest — content included (ADR 0012). */
export interface LibrarySkill {
  name: string;
  description: string;
  instructions: string;
  /** relative path ("SKILL.md" + supporting files) -> content */
  files: Record<string, string>;
}

/** A library agent carried by the manifest — content included (ADR 0012). */
export interface LibraryAgent {
  name: string;
  description: string;
  instructions: string;
}

export interface PurposeAgent {
  purpose: string;
  agent: string;
  source: "library" | "plugin";
  description?: string;
}

/** A tool resolved against the catalog → a real (or placeholder) MCP server. */
export interface ToolMount {
  name: string;
  /** mirrors the .mcp.json server types (stdio = local command; http/sse = remote url) */
  kind: "stdio" | "http" | "sse";
  /** stdio only */
  command?: string;
  args: string[];
  env: Record<string, string>;
  keySource: "company" | "none";
  /** http/sse only */
  url?: string;
}

export interface Manifest {
  namespace: string;
  user: { id: string; name: string };
  /** every purpose this human belongs to (with role + scope). Access = union of subtrees. */
  assignments: Assignment[];
  /** every purpose visible from the assumed ones (each self + descendants) */
  visiblePurposes: string[];
  okf: OkfMount[];
  surreal: SurrealMount[];
  /** mcp server names to declare (tools of visible purposes) — for the index */
  tools: string[];
  /** tools resolved against the registry (real configs) */
  toolMounts: ToolMount[];
  /** resolved company keys → settings.local.json env (filled by the service layer) */
  toolEnv: Record<string, string>;
  /** Logical "plugin@marketplace" requirements — EXTERNAL content only. */
  plugins: string[];
  /** Used logical marketplaces with per-harness distribution bindings. */
  marketplaces: Record<string, MarketplaceDef>;
  /** library skills this identity carries — emit materializes them into .claude/skills/ */
  librarySkills: LibrarySkill[];
  /** library agents of the visible purposes (deduped) — emit → .claude/agents/ */
  libraryAgents: LibraryAgent[];
  /** purpose -> agent routing map for the root instructions. */
  purposeAgents: PurposeAgent[];
  /** ambient skills, always on */
  ambientSkills: string[];
  /** tenant-authored Markdown, identical in every identity and harness projection */
  tenantInstructions?: string;
  /** skills of visible purposes (for the CLAUDE.md index) */
  skills: string[];
  /** decision domains of the visible purposes (ADR 0013) — affordance for the
   *  decisions MCP; the db enforces read/write by the owner's lineage */
  decisionDomains: string[];
}

/** Collect a purpose and all of its transitive children. */
function descendants(rootId: string, def: Definition): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const p of def.purposes) {
    if (p.parent) {
      const arr = childrenOf.get(p.parent) ?? [];
      arr.push(p.id);
      childrenOf.set(p.parent, arr);
    }
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}

export interface ResolveOpts {
  /** central repo store root; defaults to ~/merovingian/<ns>/repos */
  storeRoot?: string;
  /**
   * Narrow the projection to a subset of purposes (each expanded to its
   * descendants). Bounded by entitlement: a purpose outside what the user can
   * access throws. Can only ever SUBTRACT — never expands privilege.
   * Omit/empty = project the full entitlement.
   */
  purposes?: string[];
}

export function resolve(def: Definition, user: User, opts: ResolveOpts = {}): Manifest {
  const storeRoot = opts.storeRoot ?? repoStore(def.namespace);
  if (!user.assignments.length) throw new Error(`user "${user.id}" has no assignment`);

  // entitlement = the ceiling: the union of every assignment's subtree. Access is
  // role-blind (owner and member get the same workspace); role only gates governance.
  const entitledSet = new Set<string>();
  for (const a of user.assignments) for (const d of descendants(a.purpose, def)) entitledSet.add(d);
  const entitlement = [...entitledSet];

  // scope is per-assignment: it scopes that assignment's subtree. Map each entitled
  // purpose to the scope that reached it; an UNSCOPED path wins (broader access).
  const scopeByPurpose = new Map<string, string | undefined>();
  for (const a of user.assignments) {
    for (const d of descendants(a.purpose, def)) {
      if (!entitledSet.has(d)) continue;
      if (!scopeByPurpose.has(d)) scopeByPurpose.set(d, a.scope);
      else if (a.scope === undefined) scopeByPurpose.set(d, undefined);
    }
  }

  // projection-scope = the floor the user chose, intersected with entitlement.
  let visible = entitlement;
  if (opts.purposes && opts.purposes.length) {
    const selected = new Set<string>();
    for (const sel of opts.purposes) {
      if (!entitledSet.has(sel)) {
        throw new Error(`"${sel}" is not in your access. Run: merovingian graph ${def.namespace}`);
      }
      for (const d of descendants(sel, def)) if (entitledSet.has(d)) selected.add(d);
    }
    visible = [...selected];
  }
  const visibleSet = new Set(visible);
  const byId = new Map(def.purposes.map((p) => [p.id, p]));
  const bucketById = new Map<string, Bucket>(def.buckets.map((b) => [b.id, b]));

  // 2. buckets = owns ∪ reads across visible purposes
  const bucketIds = new Set<string>();
  for (const id of visible) {
    const p = byId.get(id);
    if (!p) continue;
    for (const b of p.owns) bucketIds.add(b);
    for (const b of p.reads) bucketIds.add(b);
  }

  // A row-scoped bucket (bucket.rowScope set) is scoped by the assignment that
  // GRANTS it. Among the visible purposes that own/read it, an unscoped granting
  // path means full access (broader wins); otherwise stamp the granting
  // assignment's scope.
  const bucketScope = (bid: string): string | undefined => {
    let chosen: string | undefined;
    let scoped = false;
    let unscoped = false;
    for (const id of visible) {
      const p = byId.get(id);
      if (!p || (!p.owns.includes(bid) && !p.reads.includes(bid))) continue;
      const s = scopeByPurpose.get(id);
      if (s === undefined) unscoped = true;
      else { chosen = s; scoped = true; }
    }
    return scoped && !unscoped ? chosen : undefined;
  };

  const okf: OkfMount[] = [];
  const surreal: SurrealMount[] = [];
  for (const bid of [...bucketIds].sort()) {
    const b = bucketById.get(bid);
    if (!b) continue;
    if (b.backend === "okf-repo" && b.repo) {
      okf.push({ bucket: b.id, repo: b.repo, path: repoDir(storeRoot, b.repo) });
    } else if (b.backend === "surreal") {
      // stamp format: "<rowScope field>:<assignment scope>" (e.g. "account:north").
      const sc = b.rowScope ? bucketScope(bid) : undefined;
      surreal.push({ bucket: b.id, tables: b.tables ?? [], scope: sc ? `${b.rowScope}:${sc}` : undefined });
    }
  }

  // 5/6: collect tools + skills + decision domains across visible purposes (membership)
  const toolSet = new Set<string>();
  const skillSet = new Set<string>();
  const domainSet = new Set<string>();
  for (const id of visible) {
    const p = byId.get(id);
    if (!p) continue;
    for (const t of p.tools) toolSet.add(t);
    for (const s of p.skills) skillSet.add(s);
    for (const d of p.decides) domainSet.add(d);
  }

  // 7. the "meat": each needed skill — visible + ambient — resolves via the catalog
  // to EITHER an external plugin@marketplace (→ enabledPlugins) OR library content
  // (→ materialized into .claude/skills by emit). Unresolved names deliver nothing
  // (they stay in the index; governance owns that gap, like an uncatalogued tool).
  const neededSkills = new Set<string>([...skillSet, ...def.ambient.skills]);
  const pluginSet = new Set<string>();
  const usedMarketplaces = new Set<string>();
  const librarySkills: LibrarySkill[] = [];
  const libraryAgentByName = new Map<string, { description: string; instructions: string }>();
  const purposeAgents: PurposeAgent[] = [];
  const addPlugin = (entry: { plugin: string; marketplace: string }) => {
    pluginSet.add(`${entry.plugin}@${entry.marketplace}`);
    usedMarketplaces.add(entry.marketplace);
  };
  for (const s of [...neededSkills].sort()) {
    const ref = def.skillCatalog[s];
    if (!ref) continue;
    if (ref.source === "plugin") addPlugin(ref);
    else {
      const parsed = parseSkillMarkdown(s, ref.files["SKILL.md"] ?? "");
      librarySkills.push({
        name: s,
        description: parsed.description,
        instructions: parsed.instructions,
        files: ref.files,
      });
    }
  }
  // each visible purpose enables its agent (persona) — even with zero skills.
  for (const id of visible) {
    const a = def.agentByPurpose[id];
    if (!a) continue;
    if (a.source === "plugin") {
      addPlugin(a);
      purposeAgents.push({ purpose: id, agent: `${a.plugin}@${a.marketplace}`, source: "plugin" });
    } else if (a.description !== undefined && a.content !== undefined) {
      libraryAgentByName.set(a.name, { description: a.description, instructions: a.content });
      purposeAgents.push({ purpose: id, agent: a.name, source: "library", description: a.description });
    }
  }
  const libraryAgents: LibraryAgent[] = [...libraryAgentByName.keys()].sort().map((name) => ({
    name,
    ...libraryAgentByName.get(name)!,
  }));
  const plugins = [...pluginSet].sort();
  const marketplaces: Record<string, MarketplaceDef> = {};
  for (const name of [...usedMarketplaces].sort()) {
    if (def.marketplaces[name]) marketplaces[name] = def.marketplaces[name];
  }

  // tools → mounts via the registry; uncatalogued tools become placeholders.
  const toolMounts: ToolMount[] = [...toolSet].sort().map((name) => {
    const def_ = def.toolCatalog[name];
    if (def_ && def_.kind !== "stdio") return { name, kind: def_.kind, args: [], env: {}, keySource: "none" as const, url: def_.url };
    if (def_) return { name, kind: "stdio" as const, command: def_.command, args: def_.args, env: def_.env, keySource: def_.keySource };
    return { name, kind: "stdio" as const, command: "echo", args: [`stub:${name}`], env: {}, keySource: "none" as const };
  });

  return {
    namespace: def.namespace,
    user: { id: user.id, name: user.name },
    assignments: user.assignments.map((a) => ({ purpose: a.purpose, ...(a.scope ? { scope: a.scope } : {}), role: a.role })),
    visiblePurposes: visible.filter((id) => visibleSet.has(id)).sort(),
    okf,
    surreal,
    tools: [...toolSet].sort(),
    toolMounts,
    toolEnv: {},
    plugins,
    marketplaces,
    librarySkills,
    libraryAgents,
    purposeAgents: purposeAgents.sort((a, b) => a.purpose.localeCompare(b.purpose)),
    ambientSkills: [...def.ambient.skills],
    ...(def.ambient.instructions !== undefined ? { tenantInstructions: def.ambient.instructions } : {}),
    skills: [...skillSet].sort(),
    decisionDomains: [...domainSet].sort(),
  };
}

/** One-line human label for a set of assignments, e.g.
 *  "marketing-conteudo (owner) · delivery @ nord (member)". */
export function assignmentsLabel(assignments: Assignment[]): string {
  return assignments
    .map((a) => `${a.purpose}${a.scope ? ` @ ${a.scope}` : ""} (${a.role})`)
    .join(" · ");
}

/** Resolve company-key ${VAR} refs from an environment → settings.local.json env.
 *  Runs in the service layer (server-side env), not in pure resolve. */
export function resolveToolEnv(mounts: ToolMount[], env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of mounts) {
    if (m.keySource !== "company") continue;
    for (const [key, ref] of Object.entries(m.env)) {
      const name = ref.replace(/^\$\{(.+)\}$/, "$1");
      const val = env[name];
      if (val) out[key] = val;
    }
  }
  return out;
}
