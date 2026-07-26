// The baseline a new tenant repo is scaffolded from (roadmap II.2). Pure string/object
// templates — the command (init.ts) writes them. The graph.yaml is a KNOWN-VALID minimal
// graph (passes loadGraphFile + validateGraph); the settings.json is a LEAN, committed
// config (NOT emit.ts's buildSettings, which injects a fake token/MCP/dirs).

/** The public Merovingian marketplace the tenant's governance tooling installs from. */
export const MEROVINGIAN_MARKETPLACE = "supernova-labs/merovingian";

/** The committed .claude/settings.json a tenant repo carries: declare the marketplace +
 *  enable the governance plugin. No token, no env, no MCP — those are per-build (.local). */
export interface TenantSettings {
  $schema: string;
  extraKnownMarketplaces: Record<string, { source: { source: "github"; repo: string }; autoUpdate: boolean }>;
  enabledPlugins: Record<string, boolean>;
}

export function baselineSettings(): TenantSettings {
  return {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    extraKnownMarketplaces: {
      merovingian: { source: { source: "github", repo: MEROVINGIAN_MARKETPLACE }, autoUpdate: true },
    },
    enabledPlugins: { "governance@merovingian": true },
  };
}

/** A minimal, schema-valid tenant graph: a root shell purpose + the owner + ambient FFF.
 *  Fully self-contained (ADR 0012): every skill/agent resolves from the seeded library/
 *  by convention — no marketplace, no external repo needed. External plugins, when the
 *  tenant wants them, are added as `marketplaces:` + explicit `plugin@marketplace` refs. */
export function baselineGraphYaml(tenant: string, owner: string, github: string): string {
  return `# The ${tenant} tenant graph — the desired state.
# Edit it in a PR; reconcile with \`merovingian deploy\`. Ids are stable slugs (never mutate).

namespace: ${tenant}

# ambient: system skills, always on (governance is NOT here — it's repo tooling, ADR 0010).
# journal/friction/pending resolve from library/skills/<name>/ — seeded by init, yours to evolve.
ambient:
  skills: [journal, friction, pending]

tools: {}

# skills: catalog is for EXTERNAL refs only (plugin@marketplace). Everything local
# resolves from library/ by convention — no entry needed. marketplaces: is optional
# and only declared when external content appears.

agents:
  shell:
    description: "The tenant shell — the orchestrator everyone lands on; routes requests to the right purpose."

# purposes: the tree. Start with the shell; grow it via governance.
purposes:
  - id: ${tenant}
    parent: null
    reason: "shell — everyone lands here; routes to the purposes"
    agent: shell
    decides: []
    owns: []
    reads: []
    skills: [route]
    tools: []

buckets: []

users:
  - id: ${owner}
    name: ${owner}
    github: ${github}
    assignments:
      - { purpose: ${tenant}, role: owner }
`;
}

export function baselineReadme(tenant: string): string {
  return `# ${tenant}

The Merovingian tenant graph for **${tenant}** — the desired state of the org. \`graph.yaml\` is the
source of truth; edit it in a PR and reconcile with \`merovingian deploy\`.

## First run

Open this repo in Claude Code and **approve the \`merovingian\` marketplace + the \`governance\`
plugin** when prompted — that's a per-machine trust gate; it can't be pre-approved. Then the
architect agent + the operations skill are available to help you evolve the graph.

## Layout

- \`graph.yaml\` — the whole tenant graph (the desired state).
- \`merovingian.toml\` — per-tenant connection (optional): uncomment \`[surreal] url\` to point
  this tenant at its own SurrealDB; \`deploy\` registers it on your machine so every command
  finds it. Credentials never go here — env or a gitignored \`.env\`.
- \`library/\` — this tenant's behavioral content: \`agents/<name>.md\` +
  \`skills/<name>/SKILL.md\`. Seeded by \`init\` (journal, friction, route, shell) —
  **yours to evolve** via governance; \`deploy\` ships it, \`build\` materializes each
  person's slice into their workspace. \`merovingian library update\` pulls newer
  templates (audit-first).

## Operating

Run from inside this repo (reads \`./graph.yaml\` + \`./library\`; namespace \`${tenant}\`):

\`\`\`sh
merovingian deploy plan    # audit: diff graph.yaml + library × Surreal (read-only)
merovingian deploy apply   # converge — first run included (add --yes to allow deletions)
merovingian reset          # DEV/TEST only: wipe structure + reproject (never on a live tenant)
\`\`\`

Needs a reachable SurrealDB. Next: grow the purpose tree, add library skills/agents,
and declare \`marketplaces:\` only when you want external plugins.
`;
}

export function baselineGitignore(): string {
  return [".DS_Store", "*.log", ".env", ".merovingian/", "node_modules/", ""].join("\n");
}

/** The committed merovingian.toml — per-tenant connection, shipped commented-out
 *  (absent config = the local docker default). NEVER credentials here: the file is
 *  committed; user/pass come from env or a gitignored .env. */
export function baselineMerovingianToml(): string {
  return `# Per-tenant connection (optional). Authoring commands (deploy, reset) read this
# file from the repo root and register the url on your machine, so namespace-keyed
# commands (build, login, inbox, decisions, data) reach the same server from anywhere.
# Absent/commented = the default local SurrealDB (ws://localhost:8020/rpc).
#
# Credentials NEVER go here (this file is committed) — set SURREAL_USER /
# SURREAL_PASS in your env or in a gitignored .env.

# [surreal]
# url = "ws://localhost:8020/rpc"
`;
}
