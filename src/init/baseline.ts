import { stringify } from "yaml";

/** New tenants start with the graph only; capabilities arrive through plugins. */
export function baselineGraphYaml(tenant: string, owner: string, github: string): string {
  return stringify({namespace: tenant, ambient: {skills: [], instructions: `Respect the authenticated identity and purpose access boundaries of ${tenant}. Keep material changes reviewable; never expose credentials or private information.`}, marketplaces: {}, skills: {}, tools: {}, purposes: [{id: tenant, parent: null, reason: "Coordinate the tenant", owns: [], reads: [], skills: [], tools: []}], buckets: [], users: [{id: owner, name: owner, github, journalAdmin: true, assignments: [{purpose: tenant, role: "owner"}]}]});
}
export function baselineReadme(tenant: string): string {
  return `# ${tenant}

Edit graph.yaml through reviewed changes. Configure the connection in merovingian.toml,
then run merovingian deploy plan and merovingian deploy apply with administrative credentials.
Use merovingian passwd to set each member's individual password.

Declare marketplaces and plugin references in the graph. The tenant's setup skill
consults the authenticated catalog, proposes plugin installation, and asks the human
to approve. Repositories can be cloned into a personal directory; no generated
workspace, context symlinks, or local library is required.

General instructions live in ambient.instructions and are available through the
catalog MCP. Journal formatting belongs to the tenant's skill; the motor stores
immutable text and optional references.

Keep credentials and historical archives outside Git. Release support targets macOS,
Claude Code (terminal and desktop), and Codex (terminal and desktop).
`;
}
export function baselineMerovingianToml(): string {
  return `# Optional tenant connection; never put credentials in this committed file.
# [surreal]
# url = "ws://localhost:8020/rpc"
`;
}
export function baselineGitignore(): string {
  return [".DS_Store", "*.log", ".env", ".merovingian/", "node_modules/", ""].join("\n");
}
