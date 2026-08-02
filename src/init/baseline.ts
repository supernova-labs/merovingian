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

/** A minimal, schema-valid tenant graph: a root shell purpose + the owner + ambient operations.
 *  Fully self-contained (ADR 0012): every skill/agent resolves from the seeded library/
 *  by convention — no marketplace, no external repo needed. External plugins, when the
 *  tenant wants them, are added as `marketplaces:` + explicit `plugin@marketplace` refs. */
export function baselineGraphYaml(tenant: string, owner: string, github: string): string {
  return `# The ${tenant} tenant graph — the desired state.
# Edit it in a PR; reconcile with \`merovingian deploy\`. Ids are stable slugs (never mutate).

namespace: ${tenant}

# ambient: system skills, always on (governance is NOT here — it's repo tooling, ADR 0010).
# journal/friction/pending/update-workspace resolve from library/skills/<name>/ — seeded by init, yours to evolve.
ambient:
  skills: [journal, friction, pending, update-workspace]

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

/** Tenant-owned ambient instructions. Unlike the skill/agent seeds, this file is
 * intentionally outside the Source template catalog, so `library update` never
 * overwrites the tenant's evolved operating context. */
export function baselineWorkspaceInstructions(tenant: string): string {
  return `You are operating inside the **${tenant}** tenant.

- Respect the identity, purpose scope, and access boundaries projected into this workspace.
- Treat ratified decisions as binding; never turn in-flight logs or assumptions into policy.
- Never expose credentials, secrets, or private operational data in commits, generated artifacts, or shared knowledge.
- Keep material changes reviewable and preserve an audit trail.
- If instructions conflict or authority is unclear, stop and ask the responsible human.
`;
}

export function baselineReadme(tenant: string): string {
  return `# ${tenant}

The Merovingian tenant graph for **${tenant}** — the desired state of the org. \`graph.yaml\` is the
source of truth; edit it in a PR and reconcile with \`merovingian deploy\`.

## First run

Open this repo in Claude Code and **approve the \`merovingian\` marketplace + the \`governance\`
plugin** when prompted — that's a per-machine trust gate; it can't be pre-approved. Then the
architect agent and the \`merovingian\`, \`tenant-admin\`, and \`drain\` skills are available: start
with \`merovingian\`, use \`tenant-admin\` for access/workspace operations, and \`drain\` for the
periodic governance pass.

In a generated member workspace, invoke \`/update-workspace\` in Claude or \`$update-workspace\`
in Codex to refresh the global CLI, rebuild the same projection, and fast-forward its context repos.
The skill performs a safety preflight and asks before changing the machine.

## Layout

- \`graph.yaml\` — the whole tenant graph (the desired state).
- \`merovingian.toml\` — per-tenant connection (optional): uncomment \`[surreal] url\` to point
  this tenant at its own SurrealDB; \`deploy\` registers it on your machine so every command
  finds it. Credentials never go here — env or a gitignored \`.env\`.
- \`library/\` — this tenant's behavioral content: \`agents/<name>.md\` +
  \`skills/<name>/SKILL.md\`, plus \`workspace.md\` for tenant-wide context and operating
  instructions. The workspace file is **tenant-owned** and reaches every member; never put
  secrets or audience-specific information there. \`deploy\` ships library content and each
  person's next \`build\` updates their workspace. \`merovingian library update\` refreshes
  only Source-owned skill/agent templates (audit-first); it never touches \`workspace.md\`.

## Operating

Run from inside this repo (reads \`./graph.yaml\` + \`./library\`; namespace \`${tenant}\`):

\`\`\`sh
merovingian deploy plan    # audit: diff graph.yaml + library × Surreal (read-only)
merovingian deploy apply   # converge — first run included (add --yes to allow deletions)
merovingian reset          # DEV/TEST only: wipe structure + reproject (never on a live tenant)
\`\`\`

Needs a reachable SurrealDB. Next: review \`library/workspace.md\`, grow the purpose tree,
add library skills/agents, and declare \`marketplaces:\` only when you want external plugins.
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
