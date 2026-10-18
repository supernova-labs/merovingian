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

## Follow-up: native plugins and KB reading

On 2026-10-18 UTC, a synthetic local marketplace (`mero-setup-test-20261018`)
was registered with both native CLIs. Its `mero-setup-probe` plugin version `0.0.1`
contained one shared skill pointing to one synthetic KB file outside the workspace.
Claude installed it at user scope; Codex installed it using its native plugin command.
No `context` links, build stamps, or copied skills were involved.

| Surface | Native installation | Skill discovery and KB marker |
|---|---|---|
| Claude Code terminal | Pass, user scope | Pass, Skill and Read |
| Claude Code desktop, existing Code session | Shared personal installation | Pass, Skill and Read |
| Codex terminal | Pass | Pass, installed skill then file read |
| Codex desktop, fresh test chat | Shared personal installation | Pass, discovered skill then file read |

The initial Codex terminal probe used `--ignore-user-config` and explicit overrides
for the synthetic plugin and marketplace. A later investigation corrected the
initial diagnosis of its failed first attempt: incorrectly quoted configuration
override keys caused the transport error; it was not evidence of a broken personal
MCP configuration. The personal configuration was not repaired or replaced.

The Core setup helper now has read-only native inventory and clone diagnostics,
with 18 regression tests covering repeat execution, wrong origins, dirty clones,
symlinks, nested repositories, duplicate marketplace names, unavailable inventory,
disabled or project-scoped plugins, and on-demand version checks pinned to a GitHub commit. These tests do not prove remote repository
grants, published plugin freshness, or complete personal MCP onboarding. Those
remain explicit release checks.

A fresh Codex desktop chat subsequently discovered the installed skill in its native
inventory and read the expected synthetic KB marker. The earlier, already-running
chat had not refreshed its skill inventory. The synthetic plugin and marketplace
were removed after verification; the test chat retains the evidence. All four
surfaces have now passed this local plugin-discovery and KB-read probe.


## Follow-up: personal MCP onboarding

The Core connection helper writes native personal catalog and Journal definitions,
accepting credentials through hidden terminal prompts or private stdin. It preserves
unrelated entries, rejects conflicting connections and unsafe file links, writes
mode 0600, detects observed concurrent changes, and supports idempotent retries.
The complete Core suite passed 30 tests, including an opt-in live test against the
synthetic `acme_onboarding` database: both generated client formats served identity,
catalog and Journal from two empty project folders; a wrong password was rejected
without echoing it. No build or workspace environment file was created.

Native personal-config checks on 2026-10-18:

| Surface | identity, catalog, list-journals |
|---|---|
| Claude Code terminal in a separate empty folder | Pass |
| Codex terminal in another empty folder | Pass |
| Codex desktop, this implementation chat and existing test chat | Pass |
| Claude Code desktop, pre-existing session | New servers not discovered; fresh session still required |

Claude Code CLI 2.1.302 on this machine writes user-scope MCPs to
`~/.claude/.config.json`, confirmed with a temporary inert native CLI entry, which
was then removed. Older configuration/documentation uses `~/.claude.json`.
The helper requires an explicit confirmed path when both files exist, rather than
silently updating an ignored file. Tool discovery must account for normalized
underscores in API namespaces instead of searching only literal server-name hyphens.

These checks use a disposable local tenant and do not prove remote repository grants,
published-package installation, or a completed release gate. The old Claude desktop
session did not refresh its MCP list after personal configuration changed; its
successful earlier project-config smoke is separate evidence.
