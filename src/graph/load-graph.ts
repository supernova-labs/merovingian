// Load the tenant graph from its YAML desired-state (ADR 0009) + the tenant
// library (ADR 0012).
//
// Contract v2: the `skills:` catalog holds ONLY external refs — always explicit
// `plugin@marketplace`. Any referenced skill/agent name NOT in the catalog resolves
// by convention to the tenant library next to the yaml:
//   library/skills/<name>/SKILL.md [+ supporting files]
//   library/agents/<name>.md
// The library is part of the DESIRED STATE: `parseGraph` folds its content into the
// Definition, deploy persists it, and build materializes it — a member never needs
// to read the tenant repo.
//
// Cross-reference validation (owner points at a real purpose, skill resolvable, …)
// is NOT here — that's `validateGraph` (pure), run by every deploy.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { AgentRef, DecisionDef, Definition, PluginRef, SkillRef, User } from "../provider/types.ts";

// kind mirrors the .mcp.json server types: stdio (local command, the default) or
// http/sse (a remote MCP endpoint — url only; member auth is Claude Code's OAuth).
const ToolSchema = z.object({
  kind: z.enum(["stdio", "http", "sse"]).default("stdio"),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  keySource: z.enum(["company", "none"]).default("none"),
  url: z.string().optional(),
}).strict().superRefine((t, ctx) => {
  if (t.kind === "stdio") {
    if (!t.command) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kind stdio requires command" });
    if (t.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "url is for kind http/sse" });
  } else {
    if (!t.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `kind ${t.kind} requires url` });
    if (t.command || t.args.length || Object.keys(t.env).length || t.keySource !== "none") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `kind ${t.kind} takes only url (command/args/env/keySource are stdio-only)` });
    }
  }
});

// `agent` inline on the purpose; the loader lifts it out into agentByPurpose.
const PurposeSchema = z.object({
  id: z.string(),
  parent: z.string().nullable().default(null),
  reason: z.string(),
  agent: z.string().optional(),
  decides: z.array(z.string()).default([]),
  owns: z.array(z.string()).default([]),
  reads: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
}).strict();

const BucketSchema = z.object({
  id: z.string(),
  backend: z.enum(["okf-repo", "surreal", "platform"]),
  repo: z.string().optional(),
  tables: z.array(z.string()).optional(),
  owner: z.string(),
  rowScope: z.string().optional(),
  sens: z.enum(["low", "medium", "high"]),
}).strict();

const AssignmentSchema = z.object({
  purpose: z.string(),
  scope: z.string().optional(),
  role: z.enum(["owner", "member"]).default("member"),
}).strict();

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  github: z.string().optional(),
  assignments: z.array(AssignmentSchema).default([]),
}).strict();

// catalog values are EXTERNAL refs — always explicit plugin@marketplace. Local
// content needs no catalog entry (it resolves from library/ by convention).
const ExternalRef = z.string().regex(/^[^@\s]+@[^@\s]+$/, {
  message: 'catalog refs are explicit "plugin@marketplace"; local content resolves from library/ by convention — drop the entry',
});

// .strict() everywhere: contract v2 has no back-compat — a leftover `razao:`,
// bucket `scope:` or `defaultMarketplace:` must fail loudly, not be ignored.
const GraphSchema = z.object({
  namespace: z.string(),
  ambient: z.object({ skills: z.array(z.string()).default([]) }).strict().default({ skills: [] }),
  marketplaces: z.record(z.string()).default({}),
  tools: z.record(ToolSchema).default({}),
  skills: z.record(ExternalRef).default({}),
  purposes: z.array(PurposeSchema),
  buckets: z.array(BucketSchema).default([]),
  users: z.array(UserSchema).default([]),
}).strict();

/** The tenant library, listed: name -> files (skills) / content (agents). */
export interface TenantLibrary {
  /** skill name -> relative path -> content ("SKILL.md" expected) */
  skills: Record<string, Record<string, string>>;
  /** agent name -> markdown content */
  agents: Record<string, string>;
}

const EMPTY_LIBRARY: TenantLibrary = { skills: {}, agents: {} };

/** Recursively read a skill folder into a relPath -> content map. */
function readFileTree(root: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) Object.assign(out, readFileTree(abs, rel));
    else out[rel] = readFileSync(abs, "utf8");
  }
  return out;
}

/** Read the tenant library at <tenantDir>/library. Absent dir = empty library. */
export function loadLibrary(tenantDir: string): TenantLibrary {
  const root = join(tenantDir, "library");
  if (!existsSync(root)) return EMPTY_LIBRARY;
  const lib: TenantLibrary = { skills: {}, agents: {} };
  const agentsDir = join(root, "agents");
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (!f.endsWith(".md")) continue;
      lib.agents[f.slice(0, -3)] = readFileSync(join(agentsDir, f), "utf8");
    }
  }
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const dir = join(skillsDir, name);
      if (!statSync(dir).isDirectory()) continue;
      lib.skills[name] = readFileTree(dir);
    }
  }
  return lib;
}

/** Ratified decision records: "<domain>/<slug>" -> DecisionDef (ADR 0013). */
export type TenantDecisions = Record<string, DecisionDef>;

const DecisionFrontmatter = z.object({
  status: z.enum(["proposed", "accepted", "superseded"]),
  title: z.string(),
  supersedes: z.string().optional(),
  date: z.union([z.string(), z.date()]).optional(),
}).strict();

/** Read the tenant decisions at <tenantDir>/decisions — one folder per domain, one
 *  `NNNN-slug.md` per record (yaml frontmatter + verbatim markdown body). Absent
 *  dir = no records. The domain is the FOLDER; the record id is `<domain>/<slug>`. */
export function loadDecisions(tenantDir: string): TenantDecisions {
  const root = join(tenantDir, "decisions");
  if (!existsSync(root)) return {};
  const out: TenantDecisions = {};
  for (const domain of readdirSync(root)) {
    const dir = join(root, domain);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const raw = readFileSync(join(dir, f), "utf8");
      const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!m) throw new Error(`decision ${domain}/${f}: missing frontmatter (--- yaml --- + body)`);
      const fm = DecisionFrontmatter.parse(parseYaml(m[1]!));
      out[`${domain}/${f.slice(0, -3)}`] = {
        domain,
        status: fm.status,
        title: fm.title,
        content: m[2]!,
        ...(fm.supersedes !== undefined ? { supersedes: fm.supersedes } : {}),
        ...(fm.date !== undefined ? { at: new Date(fm.date).toISOString() } : {}),
      };
    }
  }
  return out;
}

/** Split an explicit `plugin@marketplace` ref (shape guaranteed by ExternalRef). */
function pluginRef(ref: string): PluginRef {
  const at = ref.indexOf("@");
  return { source: "plugin", plugin: ref.slice(0, at), marketplace: ref.slice(at + 1) };
}

export interface LoadedGraph {
  definition: Definition;
  users: Record<string, User>;
}

/** Validate + expand a graph YAML string (+ the tenant library) into a Definition
 *  and users. `library` is injected so the parse stays pure/offline-testable —
 *  `loadGraphFile` wires the real folder. */
export function parseGraph(yamlText: string, library: TenantLibrary = EMPTY_LIBRARY, decisions: TenantDecisions = {}): LoadedGraph {
  const g = GraphSchema.parse(parseYaml(yamlText));

  // external catalog (authored) …
  const skillCatalog: Record<string, SkillRef> = {};
  for (const [name, ref] of Object.entries(g.skills)) skillCatalog[name] = pluginRef(ref);

  const agentByPurpose: Record<string, AgentRef> = {};
  const purposes: Definition["purposes"] = g.purposes.map((p) => {
    if (p.agent) {
      // "@" is the discriminator: external plugin ref vs library agent name.
      agentByPurpose[p.id] = p.agent.includes("@")
        ? pluginRef(p.agent)
        : { source: "library", name: p.agent, ...(library.agents[p.agent] !== undefined ? { content: library.agents[p.agent] } : {}) };
    }
    return {
      id: p.id,
      parent: p.parent,
      reason: p.reason,
      decides: p.decides,
      owns: p.owns,
      reads: p.reads,
      skills: p.skills,
      tools: p.tools,
    };
  });

  // … + referenced library skills (by convention). Only REFERENCED names fold in —
  // unreferenced library folders are dormant, not deployed.
  const referenced = new Set<string>(g.ambient.skills);
  for (const p of g.purposes) for (const s of p.skills) referenced.add(s);
  for (const name of referenced) {
    if (skillCatalog[name]) continue;
    const files = library.skills[name];
    if (!files || files["SKILL.md"] === undefined) continue; // missing → validateGraph reports it
    for (const rel of Object.keys(files)) {
      if (rel.includes("..") || rel.startsWith("/")) throw new Error(`library skill "${name}": unsafe file path "${rel}"`);
    }
    skillCatalog[name] = { source: "library", files };
  }

  const buckets: Definition["buckets"] = g.buckets.map((b) => ({
    id: b.id,
    backend: b.backend,
    ...(b.repo !== undefined ? { repo: b.repo } : {}),
    ...(b.tables !== undefined ? { tables: b.tables } : {}),
    owner: b.owner,
    ...(b.rowScope !== undefined ? { rowScope: b.rowScope } : {}),
    sens: b.sens,
  }));

  const definition: Definition = {
    namespace: g.namespace,
    ambient: { skills: g.ambient.skills },
    purposes,
    buckets,
    toolCatalog: g.tools,
    skillCatalog,
    agentByPurpose,
    marketplaces: g.marketplaces,
    decisionCatalog: decisions,
  };

  const users: Record<string, User> = {};
  for (const u of g.users) {
    users[u.id] = {
      id: u.id,
      name: u.name,
      ...(u.github !== undefined ? { github: u.github } : {}),
      assignments: u.assignments.map((a) => ({
        purpose: a.purpose,
        ...(a.scope !== undefined ? { scope: a.scope } : {}),
        role: a.role,
      })),
    };
  }

  return { definition, users };
}

/** Read + parse a graph YAML file from disk, with its sibling library/ + decisions/. */
export function loadGraphFile(path: string): LoadedGraph {
  const dir = dirname(path);
  return parseGraph(readFileSync(path, "utf8"), loadLibrary(dir), loadDecisions(dir));
}

/** Resolve which graph.yaml an authoring command should act on: an explicit path
 *  (--graph) › the MEROVINGIAN_GRAPH env › ./graph.yaml in the cwd (the tenant repo).
 *  Throws if none exists — the CLI never bundles a tenant graph. */
export function resolveGraphPath(explicit?: string): string {
  const candidate = explicit ?? process.env.MEROVINGIAN_GRAPH ?? "graph.yaml";
  const abs = resolve(candidate);
  if (!existsSync(abs)) {
    throw new Error(
      `graph.yaml not found at "${abs}". ` +
        `Run inside a tenant repo (with ./graph.yaml) or pass --graph <path>.`,
    );
  }
  return abs;
}
