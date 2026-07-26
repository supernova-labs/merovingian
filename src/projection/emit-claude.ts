import { join } from "node:path";
import type { Artifact, Degradation, PreparedProjection } from "./artifacts.ts";
import { buildWorkspaceInstructions } from "./render-instructions.ts";
import type { Manifest } from "./resolve.ts";

/** How the surreal-data MCP gets its token — no JWT is embedded. */
export interface SurrealAccess {
  url: string;
  ns: string;
  db: string;
  service?: string;
  namespace?: string;
  user?: string;
}

const NPM_PACKAGE = "@supernova-labs/merovingian";
const CLI_BIN = join(import.meta.dir, "../../bin/merovingian.ts");
const INSTALLED = import.meta.dir.includes("node_modules") || import.meta.dir.includes("/.bun/install/");

function mcpInvocation(
  name: "inbox" | "decisions" | "surreal-data",
  env: Record<string, string>,
): { command: string; args: string[]; env: Record<string, string> } {
  return INSTALLED
    ? { command: "bunx", args: ["--bun", NPM_PACKAGE, "mcp", name], env }
    : { command: "bun", args: ["run", CLI_BIN, "mcp", name], env };
}

function tokenSourceEnv(m: Manifest, access: SurrealAccess): Record<string, string> {
  return {
    SURREAL_URL: access.url,
    SURREAL_NS: access.ns,
    MEROVINGIAN_DB: access.db,
    ...(access.service
      ? { MEROVINGIAN_SERVICE_URL: access.service, MEROVINGIAN_NAMESPACE: access.namespace ?? m.namespace }
      : { MEROVINGIAN_USER: access.user ?? m.user.id }),
  };
}

export interface SettingsJson {
  $schema: string;
  enableAllProjectMcpServers: boolean;
  permissions: { additionalDirectories: string[] };
  env: Record<string, string>;
  extraKnownMarketplaces: Record<string, { source: { source: "github"; repo: string }; autoUpdate: boolean }>;
  enabledPlugins: Record<string, boolean>;
}

export interface McpJson {
  mcpServers: Record<
    string,
    | { command: string; args: string[]; env: Record<string, string> }
    | { type: "http" | "sse"; url: string }
  >;
}

function splitPluginId(id: string): { plugin: string; marketplace: string } {
  const at = id.lastIndexOf("@");
  return { plugin: id.slice(0, at), marketplace: id.slice(at + 1) };
}

export function buildSettings(m: Manifest): SettingsJson {
  const enabledPlugins: Record<string, boolean> = {};
  const extraKnownMarketplaces: SettingsJson["extraKnownMarketplaces"] = {};
  for (const id of m.plugins) {
    const { plugin, marketplace } = splitPluginId(id);
    const binding = m.marketplaces[marketplace]?.claude;
    if (!binding) continue;
    enabledPlugins[`${plugin}@${binding.name}`] = true;
    extraKnownMarketplaces[binding.name] = {
      source: { source: "github", repo: binding.source },
      autoUpdate: true,
    };
  }

  return {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    enableAllProjectMcpServers: true,
    permissions: { additionalDirectories: m.okf.map((o) => o.path) },
    env: {
      MEROVINGIAN_NAMESPACE: m.namespace,
      MEROVINGIAN_USER: m.user.id,
      MEROVINGIAN_TOKEN: `fake-${m.user.id}-token`,
      ...m.toolEnv,
    },
    extraKnownMarketplaces,
    enabledPlugins,
  };
}

export function buildMcp(m: Manifest, access?: SurrealAccess): McpJson {
  const mcpServers: McpJson["mcpServers"] = {};
  for (const t of m.toolMounts) {
    mcpServers[t.name] =
      t.kind === "stdio"
        ? { command: t.command ?? "echo", args: t.args, env: t.keySource === "company" ? {} : t.env }
        : { type: t.kind, url: t.url ?? "" };
  }
  if (access) {
    mcpServers.inbox = mcpInvocation("inbox", {
      ...tokenSourceEnv(m, access),
      MEROVINGIAN_PURPOSES: JSON.stringify(m.visiblePurposes),
    });
    mcpServers.decisions = mcpInvocation("decisions", {
      ...tokenSourceEnv(m, access),
      MEROVINGIAN_DECISION_DOMAINS: JSON.stringify(m.decisionDomains),
    });
  }
  if (m.surreal.length && access) {
    mcpServers["surreal-data"] = mcpInvocation("surreal-data", {
      ...tokenSourceEnv(m, access),
      MEROVINGIAN_BUCKETS: JSON.stringify(m.surreal),
    });
  } else if (m.surreal.length) {
    for (const s of m.surreal) {
      mcpServers[`surreal-${s.bucket}`] = {
        command: "echo",
        args: [`stub:surreal:${s.bucket}`],
        env: { TABLES: s.tables.join(","), ...(s.scope ? { SCOPE: s.scope } : {}) },
      };
    }
  }
  return { mcpServers };
}

export function buildClaudeMd(m: Manifest, degradations: Degradation[] = []): string {
  return buildWorkspaceInstructions(m, "claude", degradations);
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

function claudeAgent(name: string, description: string, instructions: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}`;
}

export function prepareClaude(m: Manifest, access?: SurrealAccess): PreparedProjection {
  const degradations: Degradation[] = [];
  for (const id of m.plugins) {
    const { marketplace } = splitPluginId(id);
    if (!m.marketplaces[marketplace]?.claude) {
      degradations.push({
        builder: "claude",
        capability: "plugin",
        resource: id,
        reason: "the logical marketplace has no Claude binding",
      });
    }
  }

  const artifacts: Artifact[] = [
    { builder: "claude", path: "CLAUDE.md", content: buildClaudeMd(m, degradations) },
    { builder: "claude", path: ".mcp.json", content: json(buildMcp(m, access)) },
    { builder: "claude", path: ".claude/settings.local.json", content: json(buildSettings(m)), mode: 0o600 },
  ];
  for (const skill of m.librarySkills) {
    for (const [relative, content] of Object.entries(skill.files)) {
      artifacts.push({ builder: "claude", path: `.claude/skills/${skill.name}/${relative}`, content });
    }
  }
  for (const agent of m.libraryAgents) {
    artifacts.push({
      builder: "claude",
      path: `.claude/agents/${agent.name}.md`,
      content: claudeAgent(agent.name, agent.description, agent.instructions),
    });
  }
  return { artifacts, degradations };
}
