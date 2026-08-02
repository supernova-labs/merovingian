---
name: tenant-admin
description: Operate the administrative lifecycle of a Merovingian tenant. Use when a tenant admin needs to connect or bootstrap a tenant, onboard or offboard members, manage access and passwords, build or refresh workspaces, sync plugins, verify enforcement, troubleshoot runtime problems, or prepare a production rollout.
allowed-tools: Bash, Read, Edit
---

# tenant-admin — operate the tenant

Run the administrative side of a Merovingian tenant without confusing the tenant repo, a member's
workspace, or the Source checkout. Establish the target and authentication path first, prefer
read-only inspection, and preserve the separation between desired state, projected files, and
backend enforcement.

## Classify the request

Read only the reference needed for the current operation:

- Read `references/access-lifecycle.md` for users, assignments, roles/scopes, password rotation,
  onboarding, access verification, or offboarding.
- Read `references/connections-and-security.md` for `merovingian.toml`, local/remote transport,
  environment variables, password SIGNIN, the build/auth service, production, or secrets.
- Read `references/workspaces-and-diagnostics.md` for `login`, `graph`, `build`, `--purposes`,
  generated files, Codex trust, `plugins sync`, stale workspaces, or troubleshooting.

For a structural or behavioral change to `graph.yaml`, `library/`, or `decisions/`, use the
`architect` agent and its plan-before-apply workflow. For a periodic inbox/decision-log governance
pass, use the `drain` skill. A recurring operational problem may become a governance tension, but
do not turn one person's routine setup problem into a drain pass.

## Establish where you are

Identify the directory before running a mutating command:

- **Tenant repo:** contains `graph.yaml` and `library/`. Run `deploy plan/apply`, `library update`,
  and tenant authoring here. The namespace comes from the yaml.
- **Member workspace:** a separate folder where `build` writes the identity-scoped projection.
  Run `login`, `graph`, `build`, `data`, and `plugins sync` for that machine here.
- **Source checkout:** contains the Merovingian engine. Use it only for development or to invoke an
  unpublished CLI; never build a tenant workspace into it.

If the location or namespace is ambiguous, inspect without mutation. Never assume that the current
Git repository is a safe build target: `build` intentionally refuses some secret-bearing projections
inside a repository and never belongs in the tenant repo.

## Choose the authentication path

Determine which path the tenant actually uses before diagnosing access:

1. **Offline fixture:** explicit `--backend stub`; development/demo only.
2. **Local operator:** direct Surreal connection with system credentials; suitable for authoring,
   provisioning, and controlled administration.
3. **Password SIGNIN:** each member has `MEROVINGIAN_USER` and their own `MEROVINGIAN_PASS`; the
   database issues the scoped identity token.
4. **Remote service:** `namespace add` points the machine at the build/auth service; identity comes
   from the member's authenticated GitHub account.

Do not silently fall back from one path to another. In particular, never solve member onboarding by
putting root credentials or the JWT signing key on their machine.

## Operate audit-first

Use the least powerful command that proves the current state:

| Question | Read-only or scoped surface |
|---|---|
| Is desired state valid and deployed? | `merovingian deploy plan` in the tenant repo |
| What can this person structurally see? | `merovingian graph <ns>` after login |
| What rows can this identity actually read? | `merovingian data <ns> <table>` |
| What will this machine materialize? | `graph`, then `build` only when a refresh is intended |
| What does the full tenant look like? | `merovingian console <ns>` on trusted localhost only |

For any desired-state mutation: edit → `deploy plan` → human review → `deploy apply`. Deletions
require explicit confirmation and `--yes`; a blocked delete must be resolved at its referrer rather
than forced. `reset` is dev/test only and is never a recovery or production reconciliation command.

## Validate the outcome

Match validation to the operation:

- Connection or login: confirm the resolved identity and namespace without printing credentials.
- Access change: inspect `graph` as the affected identity; use `data` for sensitive Surreal tables.
- Library or tenant-wide instruction change: confirm a clean deploy, then rebuild every affected
  workspace (`library/workspace.md` affects all members).
- Workspace refresh: check build warnings, generated ownership, mounted context, harness plugin
  status, and Codex trust.
- Offboarding: confirm the user/assignment is absent, the credential was removed with the user,
  and external GitHub/marketplace access was revoked separately where applicable.

Report what was verified, what remains a manual external action, and which machines still need a
rebuild. Never claim that generation proves authorization: Surreal PERMISSIONS are the enforcement
boundary.

## Guardrails

- Never print, commit, or place credentials in `graph.yaml`, `merovingian.toml`,
  `library/workspace.md`, generated root instructions, or a reusable command transcript.
- Never hand-edit `CLAUDE.md`, `AGENTS.md`, materialized skills/agents, or generated harness config.
- Never query or mutate engine tables directly when a Merovingian command exists.
- Never grant repository or marketplace access merely because the graph declares it; external ACLs
  are a separate boundary and require an explicit administrative action.
- Never run `deploy apply --yes`, rotate a live signing key, delete a user, or expose the service
  publicly without the human seeing the exact impact first.
