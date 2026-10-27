# CLI reference

Use `merovingian` from the 1.0.1 package after publication, or
`bun /absolute/path/to/merovingian/bin/merovingian.ts` for checkout development.
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
| `console <tenant> [--backend stub\|surreal] [--port N]` | Local graph/catalog (no browser login) and Journals (personal SIGNIN), default 8888 |
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

### Local Architect Console

Run `bun bin/merovingian.ts console <tenant>` from the source checkout, or
`merovingian console <tenant>` with the installed CLI. The server binds only to
`127.0.0.1` (port 8888 by default). This is a trusted local operator tool, not a
hosted multi-user administration application. Do not expose or proxy it to a network.

Tree and Graph show purposes, assignments, plugins, tools and knowledge bases.
The graph renders locally without a CDN. Catalog shows the tenant inventory or an
administrative preview of a person's resources using the existing catalog resolver.
A preview does not impersonate that person, test their database permissions, verify
GitHub access, or inspect plugin installation/version state. KB ownership and
readership describe purpose relationships; assignment owner/member describes
accountability, not a separate repository access level.

Journals is a paginated, newest-first read-only view using an `(at, id)` cursor so concurrent appends do not shift older pages. Refresh starts a new traversal. Configure personal
`MEROVINGIAN_USER`, `MEROVINGIAN_PASS`, `MEROVINGIAN_DB`, `SURREAL_URL` and `SURREAL_NS`
in the **server process**, using the same connection and tenant as the graph.
Credentials never go to the browser. Journal reads use personal SIGNIN and database
permissions: authors see their own entries; explicit `journalAdmin` identities see
all tenant entries. There is no fallback to administrative credentials. Missing or
invalid personal configuration disables journal reading without disabling the graph.
The offline stub shows an explicitly empty demo instead of accessing a real journal.

The console serves no external scripts, prevents framing/cross-origin API access,
and requires a per-process page token for data requests. This protects the local
browser boundary; it does not authenticate other users or processes on the machine.
Graph/catalog reads still use the operator's administrative database configuration.
Tool command lines, environment values, legacy library bodies and deployment policy
are excluded from the browser payload. The page remains a privileged view of tenant
structure and people, so run it only on a trusted computer.
