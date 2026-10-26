# Catalog and Journal

These MCP servers have been available since Merovingian 1.0.0. They do not require a workspace
build. Workspace emitters and the old inbox/decision runtime have been removed.
The retired 0.5.x CLI is not interchangeable with this contract.

## Personal connection

The commands below target 1.0.1 after its publication. Run `bun x --bun @supernova-labs/merovingian@1.0.1 mcp catalog` or
`bun x --bun @supernova-labs/merovingian@1.0.1 mcp journal` as a stdio MCP
server. Configure these environment variables in the client's private MCP definition:

| Variable | Value supplied privately by the tenant administrator |
|---|---|
| `SURREAL_URL` | Database connection URL, without embedded credentials |
| `SURREAL_NS` | Database namespace |
| `MEROVINGIAN_DB` | Tenant database |
| `MEROVINGIAN_USER` | Individual user ID |
| `MEROVINGIAN_PASS` | Individual password |

A workspace `.env` is not required. Never put passwords in a shared marketplace,
skill, repository, or command-line argument. Neither server falls back to a root
account, development token, or GitHub authentication. The database must be reachable
from the member's machine under the existing private-network deployment model.

The tenant administrator maintains `github`, `email`, `slackId`, and the optional
`journalAdmin: true` flag in the user's graph definition, then reviews and applies
the deploy plan. Members cannot change these fields. `journalAdmin` only grants
journal reading across this tenant; it is independent of purpose ownership and does
not grant database administration or broader catalog access.

## Catalog

- `identity({})`: authenticated identity and assignments. No user override.
- `catalog({client?: "claude" | "codex"})`: authorized purposes, plugins,
  marketplace distribution bindings, repository read/write intent, tool requirements,
  and tenant instructions.

`apiVersion` identifies the response contract. `revision` is a deterministic SHA-256
of the returned public content; client filtering therefore affects it. It is not a
marketplace release version or proof of installation. Compare revisions only for the
same identity, tenant, and client selection. Changes outside that identity's slice
do not change its revision.

The catalog reports repository access as declared intent (`effectiveAccess:
not_verified`), plugin versions as `not_verified`, and missing client bindings as
`unsupported`. It does not probe GitHub or the local machine. Tool commands, arguments,
URLs, environment values, library bodies, and server filesystem paths are deliberately
excluded. Tools currently require out-of-band configuration. Native plugin inventory,
repository diagnostics and personal connection configuration belong to the tenant
Core setup skill; they do not require a workspace build. Library-backed skills appear
only as migration diagnostics.

Connection and read failures are errors, never an authoritative empty catalog or a
signal to revoke local resources. `invalid_credentials` means individual authentication
was refused; `invalid_configuration` covers missing connection settings or tenant/auth
configuration; `access_denied` covers an unavailable identity or no assignments;
`timeout` means the operation exceeded its wait limit; `connection_failed` identifies
recognized transport failures; `unavailable` leaves other service/read failures
unclassified. Check network/VPN reachability and service health for transport errors. Unknown driver errors
are not guessed to be authentication failures. Driver details and credentials are not returned.
Tenant instructions are available to callers; MCP availability alone does not ensure
that a client loads them into every conversation.

## Journal

- `append-journal({text, origin?, previous?})`: append free text with an optional
  previous journal ID. Formatting belongs to the tenant's skill.
- `list-journals({limit?, offset?})`: newest first, with a next offset when needed.
  The default is 50 entries and the maximum is 100. Offsets are a convenience for
  browsing, not snapshot pagination when new entries arrive concurrently.

The database stamps author and time. Each member reads their own entries; explicitly
configured journal administrators read all entries in their tenant. Neither can
update or delete entries through record authentication, including direct database
queries. Operational root credentials bypass database permissions and must never be
used by these MCP servers.

Corrections and continuity use a new entry referencing the old one. The MCP verifies
that the referenced entry is visible before writing. A reference does not grant
access to its target. Direct database writers can create dangling references; these
are not authorization links. A failed append can have an uncertain result after a
connection interruption: inspect the list before retrying.

Journal errors include a safe `code`, `operation` (`append` or `list`), `phase`
(`connect`, `read`, or `write`), and `writeOutcome`:

- `not_submitted`: connection, authentication or reference validation failed before
  any append was submitted. Fix the reported problem before trying again.
- `refused`: the database explicitly rejected the CREATE for lack of permission;
  no entry was committed. Resolve the access problem before trying again.
- `unknown`: the append was submitted but its result was not confirmed. It may have
  completed. List journals and verify before retrying; there is no automatic append retry.
- `not_applicable`: this was a list operation; retry the read after resolving the error.

An invisible or nonexistent previous entry returns `reference_unavailable` without
revealing which case applies. Query waits are bounded to 15 seconds; identity connection
stages have individual 6-second limits. A timeout does not guarantee cancellation of a
submitted write. No raw driver message, private URL, password or journal text appears
in these diagnostics. These improvements are in the development source after 1.0.1;
installed clients need a release containing them before they receive these errors.

Old inbox and decision records are not imported or made newly visible. Administrative
export/verification is available; deploy locks down existing historical tables. Follow
[History and cutover](../guides/history-and-cutover.md) before deploying to an old tenant.
The new journal table is runtime data and survives ordinary deploy reconciliation.

## Required macOS client matrix

The release gate covers Claude Code CLI, Claude Code's **Code tab** in the desktop app,
Codex CLI, and Codex desktop, using local execution. Claude chat and Cowork are outside
this matrix. Each surface must demonstrate discovery, individual authentication,
catalog, Journal, plugin use, authorized repository reading, and on-demand diagnosis.
A shared configuration format does not replace separate runtime validation.

`test/personal-mcp.test.ts` starts the actual CLI stdio servers in two unrelated temporary
folders, using synthetic individual credentials. It verifies that catalog and Journal
work without a build or a workspace environment file. This proves the process contract,
not a model session or the four native interfaces. Native setup instructions belong to
the tenant Core plugin.
