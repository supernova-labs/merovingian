---
name: merovingian
description: Explain and operate a Merovingian purpose graph. Use when starting with a tenant, choosing an administrative workflow, or understanding catalog, journal, deploy and marketplace responsibilities.
---

# Merovingian — start here

Identify the tenant repository (`graph.yaml`) and the CLI version before acting.
This plugin targets Merovingian 1.0.0. Use the published `merovingian` CLI after
checking `merovingian --version`, or invoke a matching development checkout with
`bun /absolute/path/to/merovingian/bin/merovingian.ts`. The retired 0.5.x CLI
implements a different contract.

The graph declares purposes, people, assignments, repositories and plugin references.
SurrealDB enforces personal access; the Catalog MCP exposes the authenticated slice.
Plugins provide behavior, and a tenant-owned setup skill installs them through native
client mechanisms after human approval. Deploy does not distribute files to members.

## Route the work

- Use `tenant-admin` for connections, profiles, passwords, access, onboarding and rollout.
- Use the `architect` agent, when available, for graph authoring and provider reconciliation.
  Its native adapter is packaged for Claude; the skills themselves contain the workflows.
- Use `drain` for a human-requested review of visible journals, issues and authorized
  historical evidence. It does not mark journal records as processed.

## Operate the current contract

| Intent | CLI command (prefix with the selected executable) |
|---|---|
| New tenant | `init <tenant> --owner <id> --github <login>` |
| Surreal audit / reconciliation | `deploy plan --graph <path>` / `deploy apply --graph <path>` |
| GitHub audit / reconciliation | `deploy github-plan --graph <path>` / `deploy github-apply --graph <path> --approve <revision>` |
| Individual password | `passwd <tenant> <user>` |
| Personal graph | `login <tenant> <user>`, then `graph <tenant>` with the person's password |
| MCP runtime | `mcp catalog` / `mcp journal` |
| Administrative historical export | `history export --graph <path> --output <new-private-directory>` |
| Archive integrity | `history verify --archive <directory>` |
| Trusted local operator view | `console <tenant>` |

The authenticated Catalog MCP provides `identity` and `catalog`. The Journal MCP
provides `append-journal` and `list-journals`. General instructions live in
`ambient.instructions`; callers must actually consult them. There is no promise
of automatic prompt injection.

## Boundaries

Owner/member roles express accountability, not different access to the same purpose.
A purpose's `owns` and `reads` distinguish repository write and read intent.
`journalAdmin` is an explicit independent permission. GitHub/email/Slack identifiers
are maintained administratively; they do not replace the individual password.

Use plan before apply and inspect the concrete impact within the user's authorization.
Surreal and GitHub have separate plans and credentials. GitHub apply requires its exact
reviewed revision. Archive and stop historical writers before the production cutover;
new deploys restrict historical tables. Never use reset as production recovery.

Build, local library distribution, pending, the old HTTP service and inbox/decision
commands have been removed. Preserve old files and clones until deliberately retired;
do not reinstall the old runtime to work around a failed new setup.
