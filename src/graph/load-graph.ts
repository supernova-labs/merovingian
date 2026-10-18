import { GithubPolicySchema } from "../github/policy.ts";
// Desired state contains plugin references, never local capability files.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type {
  AgentRef,
  Definition,
  MarketplaceBinding,
  MarketplaceDef,
  PluginRef,
  SkillRef,
  User,
} from "../provider/types.ts";

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
  email: z.string().email().optional(),
  slackId: z.string().min(1).optional(),
  journalAdmin: z.boolean().optional(),
  assignments: z.array(AssignmentSchema).default([]),
}).strict();

// catalog values are EXTERNAL refs — always explicit plugin@marketplace. Local
// content needs no catalog entry (it resolves from library/ by convention).
const ExternalRef = z.string().regex(/^[^@\s]+@[^@\s]+$/, {
  message: 'catalog refs are explicit "plugin@marketplace"; local library content is no longer supported',
});

const MarketplaceBindingSchema = z.union([
  z.string(),
  z.object({
    source: z.string().min(1),
    name: z.string().min(1).optional(),
  }).strict(),
]);

const MarketplaceSchema = z.union([
  z.string(),
  z.object({
    claude: MarketplaceBindingSchema.optional(),
    codex: MarketplaceBindingSchema.optional(),
  }).strict().refine((m) => m.claude !== undefined || m.codex !== undefined, {
    message: "marketplace requires at least one claude or codex binding",
  }),
]);

// .strict() everywhere: contract v2 has no back-compat — a leftover `razao:`,
// bucket `scope:` or `defaultMarketplace:` must fail loudly, not be ignored.
const GraphSchema = z.object({
  github: GithubPolicySchema.optional(),
  namespace: z.string(),
  ambient: z.object({ skills: z.array(z.string()).default([]), instructions: z.string().optional() }).strict().default({ skills: [] }),
  marketplaces: z.record(MarketplaceSchema).default({}),
  tools: z.record(ToolSchema).default({}),
  skills: z.record(ExternalRef).default({}),
  purposes: z.array(PurposeSchema),
  buckets: z.array(BucketSchema).default([]),
  users: z.array(UserSchema).default([]),
}).strict();

function normalizeWorkspaceInstructions(content: string | undefined): string | undefined {
  return content?.trim() || undefined;
}

/** Split an explicit `plugin@marketplace` ref (shape guaranteed by ExternalRef). */
function pluginRef(ref: string): PluginRef {
  const at = ref.indexOf("@");
  return { source: "plugin", plugin: ref.slice(0, at), marketplace: ref.slice(at + 1) };
}

function marketplaceBinding(value: string | { source: string; name?: string }, logicalName: string): MarketplaceBinding {
  return typeof value === "string"
    ? { source: value, name: logicalName }
    : { source: value.source, name: value.name ?? logicalName };
}

function marketplaceDef(
  value: string | {
    claude?: string | { source: string; name?: string };
    codex?: string | { source: string; name?: string };
  },
  logicalName: string,
): MarketplaceDef {
  if (typeof value === "string") {
    const binding = marketplaceBinding(value, logicalName);
    return { claude: binding, codex: binding };
  }
  return {
    ...(value.claude !== undefined ? { claude: marketplaceBinding(value.claude, logicalName) } : {}),
    ...(value.codex !== undefined ? { codex: marketplaceBinding(value.codex, logicalName) } : {}),
  };
}

export interface LoadedGraph {
  definition: Definition;
  users: Record<string, User>;
  warnings: string[];
}

/** Parse plugin references and tenant instructions without filesystem content. */
export function parseGraph(yamlText: string): LoadedGraph {
  const g = GraphSchema.parse(parseYaml(yamlText));
  const warnings: string[] = [];
  const workspaceInstructions = normalizeWorkspaceInstructions(g.ambient.instructions);

  // external catalog (authored) …
  const skillCatalog: Record<string, SkillRef> = {};
  for (const [name, ref] of Object.entries(g.skills)) skillCatalog[name] = pluginRef(ref);

  const agentByPurpose: Record<string, AgentRef> = {};
  const purposes: Definition["purposes"] = g.purposes.map((p) => {
    if (p.agent) {
      agentByPurpose[p.id] = pluginRef(ExternalRef.parse(p.agent));
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
    ...(g.github ? { github: g.github } : {}),
    namespace: g.namespace,
    ambient: {
      skills: g.ambient.skills,
      ...(workspaceInstructions !== undefined ? { instructions: workspaceInstructions } : {}),
    },
    purposes,
    buckets,
    toolCatalog: g.tools,
    skillCatalog,
    agentByPurpose,
    marketplaces: Object.fromEntries(
      Object.entries(g.marketplaces).map(([name, value]) => [name, marketplaceDef(value, name)]),
    ),
  };

  const users: Record<string, User> = {};
  for (const u of g.users) {
    users[u.id] = {
      id: u.id,
      name: u.name,
      ...(u.github !== undefined ? { github: u.github } : {}),
      ...(u.email !== undefined ? { email: u.email } : {}),
      ...(u.slackId !== undefined ? { slackId: u.slackId } : {}), ...(u.journalAdmin !== undefined ? { journalAdmin: u.journalAdmin } : {}),
      assignments: u.assignments.map((a) => ({
        purpose: a.purpose,
        ...(a.scope !== undefined ? { scope: a.scope } : {}),
        role: a.role,
      })),
    };
  }

  return { definition, users, warnings: [...new Set(warnings)].sort() };
}

/** Read only desired-state YAML. Historical content directories are not loaded. */
export function loadGraphFile(path: string): LoadedGraph {
  return parseGraph(readFileSync(path, "utf8"));
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
