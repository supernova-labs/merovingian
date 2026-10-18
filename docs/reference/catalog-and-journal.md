# Catalog and Journal (major-release work in progress)

These MCP servers are available from this checkout. They do not require a workspace
build. The existing build surfaces remain during implementation and are scheduled
for removal before the major release; they are not a supported legacy product track.

## Personal connection

Run `bun /absolute/path/to/merovingian/bin/merovingian.ts mcp catalog` or
`bun /absolute/path/to/merovingian/bin/merovingian.ts mcp journal` as a stdio MCP
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
excluded. Tools currently require out-of-band configuration; plugin delivery and
setup diagnostics are subsequent implementation steps. Library-backed skills appear
only as migration diagnostics.

Connection and read failures are errors, never an authoritative empty catalog or a
signal to revoke local resources. Driver details and credentials are not returned.
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

Old inbox and decision records are not imported or made newly visible. Their export,
retirement, and removal of old runtime surfaces are separate release requirements.
The new journal table is runtime data and survives ordinary deploy reconciliation.
