# Architecture

`graph.yaml` is parsed and validated into a provider-neutral definition. `deploy plan`
compares desired and current structure; `deploy apply` reconciles records, edges and
permissions. The Stub provider serves the synthetic example; Surreal reads persisted
structure, including the caller's permitted slice when connected as an individual.

Catalog authenticates by password, resolves the caller's identity and assignments,
and returns an explicit public field allowlist. Internal resolution types may still
represent old database records for comparison/diagnosis; they are not a public manifest
API and do not distribute capability files or secrets. New YAML accepts plugin refs
and instructions, not local library content.

Journal has a separate MCP and schema contract: append/list, authenticated author,
server time, optional previous-entry link, author/admin visibility and no product
update/delete. No pending, drain cursor or decision-promotion service is present.

GitHub reconciliation derives read/write intent and reviewers from the graph, reads
remote organization/repository state, produces a revision, and verifies that revision
again before applying. Surreal deployment and GitHub deployment are separate operations.

| Location | Responsibility |
|---|---|
| `src/graph/` | YAML, validation, structural diff, reconciliation and domain permissions |
| `src/provider/` | Stub/Surreal access and authentication primitives |
| `src/catalog/`, `src/mcp/journal.ts`, `src/mcp/` | Personal runtime contracts |
| `src/github/` | Remote policy inventory, plan and apply |
| `src/history/` | Restricted administrative export and historical-table retirement |
| `src/service/access.ts` | Optional read-only personal CLI graph resolution |
| `src/server/` | Local administrative graph console |
| `plugin/` | Administrative workflow guidance; separate distribution from npm |

No HTTP build/auth server or emitter remains. See ADRs 0019/0020 for the current
direction and older ADRs for the history of the replaced architecture.
