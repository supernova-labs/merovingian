# CLI reference

Use `bun /absolute/path/to/merovingian/bin/merovingian.ts` for this unreleased checkout.
The table omits that common prefix. Commands target a tenant database, not a Git branch.

| Command | Contract |
|---|---|
| `--help`, `help` | Print current help |
| `--version`, `version`, `-v` | Print package version |
| `init <tenant> --owner <id> --github <login>` | Create new graph/connection/readme/gitignore and initialize Git; refuse a nonempty directory |
| `deploy plan [--graph PATH]` | Read database structure, validate and show drift; may register connection locally |
| `deploy apply [--graph PATH] [--yes]` | Reconcile Surreal; --yes allows reviewed structural deletions |
| `deploy github-plan [--graph PATH] [--scope all\|permissions\|protections]` | Read-only GitHub plan and revision |
| `deploy github-apply --approve HASH [--graph PATH] [--scope ...]` | Re-read, require exact revision, apply and audit |
| `passwd <tenant> <user>` | Operator sets/rotates password from MEROVINGIAN_NEW_PASS or stdin |
| `login <tenant> <user> [--backend stub\|surreal]` | Individual password login; stub is only the synthetic fixture |
| `graph <tenant> [--backend stub\|surreal]` | Read logged-in user's graph; password required for Surreal |
| `data <tenant> <table>` | Read up to 20 visible rows using configured identity token source |
| `mcp catalog`, `mcp journal` | Strict personal stdio MCP servers |
| `mcp surreal-data` | Generic read-only domain-data MCP; mounts from MEROVINGIAN_BUCKETS |
| `console <tenant> [--backend stub\|surreal] [--port N]` | Full graph administrative view on localhost, default 8888; no authentication |
| `history export --graph PATH --output DIR` | Read-only administrative archive; new private destination required |
| `history verify --archive DIR` | Verify manifest format and payload hashes/sizes |
| `reset [--graph PATH]` | Dev/test structural wipe and provisioning; never for production or recovery |

Graph path: explicit flag, then MEROVINGIAN_GRAPH, then ./graph.yaml. Backend: explicit flag,
then MEROVINGIAN_BACKEND=stub, otherwise Surreal. Personal MCPs do not use that backend selector.

Surreal plan: 0 in sync, 1 drift, 2 validation errors. Apply: 0 applied, 1 blocked/needs-confirm,
2 validation errors; uncaught operational errors also fail. GitHub plan: 0 no changes, 1 drift,
2 blockers. GitHub apply: 0 only for verified convergence without pending invitations. Inspect
structured status for partial/drift/awaiting-invitations rather than relying on the number alone.

Surreal apply prepares schemas/permissions before structural deletion gates. A blocked or
needs-confirm result does not guarantee zero schema changes. Plans do not prove resource
installation or every schema-level property. See [GitHub details](github-deploy.md).

Removed: build, namespace add, library update, plugins sync, inbox, decisions and their old
MCPs. See [migration](../guides/history-and-cutover.md). No automatic legacy compatibility path.
