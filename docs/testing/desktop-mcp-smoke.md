# Desktop MCP smoke test

Executed on 2026-10-18 UTC against engine commit `4c35e6f`.

| Environment | Version |
|---|---|
| macOS | 27.0.1 |
| Claude desktop application | 2.42304.0 |
| Codex desktop application | 26.727.51351 |
| Standalone Claude Code CLI (inventory only) | 2.1.302 |
| Standalone Codex CLI (inventory only) | 0.160.1 |
| SurrealDB | 3.0.1, ephemeral memory store on loopback |

## Procedure and results

Two new local desktop chats used the actual native MCP tools. The database held only
the synthetic example graph, under `acme_desktop_smoke`. Both servers authenticated
as fixture member `cleo`, with an individual password. Neither chat used a shell,
SDK client, or HTTP workaround to perform the test.

| Check | Claude Code desktop (Code tab) | Codex desktop |
|---|---|---|
| Discover catalog and journal tools | Pass | Pass |
| `identity`: cleo, expected tenant | Pass | Pass |
| `catalog` with respective client filter: delivery purpose | Pass | Pass |
| `append-journal`: synthetic text, server-stamped cleo | Pass | Pass |
| `list-journals`: appended ID and author match | Pass | Pass |
| Arbitrary `user` argument rejected without changing identity | Not run | Pass |

The two returned journal IDs were independently checked in the temporary database,
with the expected synthetic texts and author. Claude's list also observed the entry
created by Codex. No real tenant was used or modified.

The fixture intentionally still contains legacy skill references. The catalog's
`undistributed_skills` diagnostic appeared truthfully; those skills were not silently
installed or represented as plugins.

## Scope of this evidence

Codex used temporary project MCP configuration; Claude used a temporary folder's
`.mcp.json`. These prove native discovery and operation in local desktop sessions,
not completed personal installation across arbitrary projects. The temporary configs
were removed and the in-memory database stopped after the test. Chats retain the
observed results; reconnecting them requires reprovisioning the synthetic environment.

Still required for the major: native terminal sessions, personal setup in all four
surfaces, plugin installation/discovery/version diagnosis, authorized KB access,
setup repetition/conflicts, and integration of historical journals. The process-level
cross-folder regression in `test/personal-mcp.test.ts` complements this evidence but
does not replace those end-to-end acceptance checks.
