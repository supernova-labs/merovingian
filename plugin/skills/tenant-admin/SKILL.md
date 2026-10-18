---
name: tenant-admin
description: Administer a Merovingian tenant. Use for individual accounts, profile identifiers, passwords, repository access, catalog and journal connections, native setup diagnostics, historical preservation or production cutover.
---

# Tenant administration

Establish the tenant, intended operation and executable version. These instructions
require Merovingian 1.0.0; verify the installed CLI version before proceeding.
For development, use a matching checkout’s absolute `bin/merovingian.ts` path.

Read the relevant reference:

- [Access lifecycle](references/access-lifecycle.md): people, assignments, GitHub permissions,
  reviewers and offboarding.
- [Connections and security](references/connections-and-security.md): connection details,
  administrative versus individual credentials, archives and rollout.
- [Setup and diagnostics](references/workspaces-and-diagnostics.md): personal MCPs, plugins,
  repository clones and on-demand freshness checks.

Inspect current state before writing. Make graph edits in the tenant repository and
review `deploy plan` before applying them. GitHub has a separate plan/apply command;
validate its exact changes and revision before execution. Existing user authorization
covers the agreed operations; seek a decision only when scope or consequences exceed it.

Keep credentials out of tracked files and output. Members receive only their individual
password and privately supplied connection details. Do not substitute administrative
credentials or signing keys when personal authentication fails.

Report effective results: database access, GitHub grants, team membership, rulesets and
client discovery are separate facts. A pending invitation is not effective membership.
A catalog entry is not an installed plugin or proof of repository access.

Historical journals/frictions/decisions remain in administrative archives. Do not mutate
an immutable journal or delete it to bypass a structural deletion blocker. Preserve local
checkouts and unrelated client settings during setup. Release publication and production
cutover require their own concrete, reviewed rollout; this skill does not grant blanket authority.
