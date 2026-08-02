---
name: merovingian
description: Start-here guide and router for operating a Merovingian tenant. Teaches the purpose-graph mental model, build versus deploy, desired-state authoring, and the CLI; routes tenant administration to tenant-admin and governance passes to drain. Use when starting with Merovingian, operating a tenant, or unsure which workflow or command applies.
allowed-tools: Bash, Read
---

# merovingian — start here

The umbrella skill for operating a Merovingian tenant. Use it when you're new to a tenant repo,
forgot which command does what, or need the mental model before touching the graph. It teaches the
model and routes you to the action; the `architect` agent drives changes end-to-end.

Assumes the `merovingian` CLI is installed (`merovingian help` works). Install the published package
for normal tenant operation:

```bash
bun add -g @supernova-labs/merovingian
```

When testing unreleased Source changes, run the checkout explicitly with
`bun /path/to/merovingian/bin/merovingian.ts <command>` so a globally installed release is not
mistaken for the current code.

## The mental model

A tenant is a **graph of purposes** stored in SurrealDB, authored as a `graph.yaml` (the desired
state) plus a `library/` folder — both live in the tenant repo:

- **purposes** — a tree; each has a `reason`, decides things, owns/reads knowledge **buckets**, and
  loads skills/tools/an agent.
- **buckets** — units of knowledge: `okf-repo` (a git KB) or `surreal` (structured/sensitive,
  optionally row-scoped by a field: `rowScope: account`). Declaring a surreal bucket is the whole
  job: `deploy apply` **provisions** its `tables` + row-level PERMISSIONS from the declaration
  (ADR 0011) — you never write DDL or PERMISSIONS by hand. Removing a bucket never drops its
  tables; the data stays until removed manually.
- **users + assignments** — a person → purpose edge, `role: owner|member`, optional `scope`.
  Access is role-blind (owner and member see the same workspace); the role only gates
  accountability. **An owner edge is never scoped.**
- **the library** — the tenant's first-party behavioral content: `library/skills/<name>/SKILL.md`,
  `library/agents/<name>.md`, and `library/workspace.md` for context and operating defaults that
  apply to **every** member. Skills and agents are **local by default**: a bare name
  (`skills: [route]`, `agent: shell`) resolves from the library by convention, no catalog entry.
  External plugins are the exception, always explicit: `audit: compliance@guild` in the `skills:`
  catalog, `agent: counsel@guild` inline — with the marketplace registered in `marketplaces:`
  (optional, external channels only). Library content is desired state too: `deploy` ships it;
  `build` materializes each person's slice and embeds the same tenant-wide workspace fragment in
  both managed root instruction files. Never put secrets or purpose-specific context there.

Two operations over that graph:

- **build** (`merovingian build <ns>`) — *projection*: materialize the scoped workspace a person is
  entitled to (managed `CLAUDE.md` + `AGENTS.md`, harness configs, buckets, their library slice,
  and tenant-wide instructions). Never edit either root file by hand; the next build replaces it.
- **deploy** — *reconciliation*: make Surreal match `graph.yaml` + `library/`.

## Choose the workflow

- Use the `architect` agent to inspect or change `graph.yaml`, `library/`, or `decisions/` through
  the plan-before-apply loop.
- Use the `tenant-admin` skill for connection/authentication, onboarding or offboarding, passwords,
  member workspaces, Codex plugins, security boundaries, production readiness, and troubleshooting.
- Use the `drain` skill for the periodic root governance pass over the learning inbox and decision
  log. Routine member setup or a one-off build failure is administration, not a drain.

## The commands

| Goal | Command |
|---|---|
| Scaffold a new tenant repo (graph + seeded library + global workspace instructions) | `merovingian init <tenant> --owner <id> --github <login>` |
| Register a remote build/auth service on this machine | `merovingian namespace add <ns> <url>` |
| Authenticate this machine | `merovingian login <ns> [user]` *(omit user for a registered remote service)* |
| Inspect the logged-in identity's structural slice | `merovingian graph <ns>` |
| Project a member workspace into the current directory | `merovingian build <ns> [--purposes a,b]` |
| Audit drift (read-only) | `merovingian deploy plan` |
| Converge the db to the graph — first run included | `merovingian deploy apply` *(bootstraps a virgin db; add `--yes` to allow deletions)* |
| Hard-reset a **dev/test** db (wipe structure + reproject) | `merovingian reset` *(from the tenant repo; reads `./graph.yaml`; never on a live tenant)* |
| Refresh the seeded library from the Source templates | `merovingian library update` *(audit-first; `--yes` applies)* |
| Set or rotate a member's password SIGNIN credential | `merovingian passwd <ns> <user>` |
| Reconcile plugins required by the current Codex workspace | `merovingian plugins sync` |
| Verify enforcement on a bucket table | `merovingian data <ns> <table>` *(rows the logged-in user can see — the db decides)* |
| Drain the learning inbox (governance) | `merovingian inbox <ns> [--all] [--drain [--ids a,b]]` *(root-only; the `drain` skill is the full pass)* |
| Triage a friction's scope (ADR 0014) | `merovingian inbox <ns> --rescope <id> --to <purpose\|root>` *(send it to a purpose's local queue — the tenant's `pending` skill resolves there — or fish it back up)* |
| Drain the decision log (governance) | `merovingian decisions <ns> [--all] [--drain [--ids a,b]]` *(root-only; promotion candidates for `decisions/`)* |
| Inspect the whole tenant graph | `merovingian console <ns>` *(read-only god-view UI)* |

Authoring commands (`deploy`, `reset`, `library update`) read the graph from `./graph.yaml` + its
sibling `library/` (run them **inside the tenant repo**) or `--graph <path>`; the namespace comes
from the yaml. Member runtime commands take a namespace and, after `login`, use that machine's
identity; root administration surfaces use operator credentials. `build` runs in a separate
workspace folder and writes into the current directory.

## The loop (how to make a change)

1. **Edit `graph.yaml` and/or `library/`** — add/change/remove a purpose, bucket, or assignment;
   edit a skill/agent prompt; or edit `library/workspace.md` when the instruction truly applies to
   the whole tenant. Content edits flow through the same loop.
2. **`merovingian deploy plan`** — see exactly what would change (create / update / delete,
   field-level; library content shows as short per-file hashes — the PR is the full diff). Exit
   `0` = in sync, `1` = drift pending, `2` = the yaml is invalid (fix it first).
3. **`merovingian deploy apply`** — converge. Deletions require `--yes`. If a delete is **blocked**
   (live data still references a record, e.g. a person with inbox entries), apply aborts atomically
   — re-point or remove the referrer, then retry.

4. **Commit after a clean apply** — the diff is the change record; a conventional message, no need
   to be asked.

**Always plan before apply.** The plan is the review; `apply` converges.

For the periodic governance pass — draining accumulated journal/friction entries into structure
changes — load the `drain` skill. Governance is subsidiary (ADR 0014): frictions carry a `scope`,
members resolve their own reach in the workspace (`pending` skill over the inbox MCP, with a
`resolved_through` trace), and the root pass keeps the synoptic view — it fixes the structural,
re-scopes the operational down, and reports where local queues stand.

## Gotchas

- **Rename = delete + create + re-point.** Ids are stable slugs and never mutate; renaming a purpose
  means removing the old id, adding the new one, and moving every reference (owners, parents,
  assignments) in the same change.
- **Own a slice ⇒ sub-purpose.** You can't make an owner edge scoped; if someone owns only part of a
  purpose, that part should be its own child purpose.
- **Prompt edits propagate via deploy + rebuild.** Editing `library/` alone changes nothing for
  members: `deploy apply` ships the content, and each affected person's next `build` refreshes
  their generated files. A `workspace.md` edit affects everyone. Never hand-edit `CLAUDE.md`,
  `AGENTS.md`, or materialized skill/agent copies.
- **`workspace.md` belongs to the tenant.** `library update --yes` refreshes only Source template
  paths and never overwrites `library/workspace.md`.
- **Only referenced library content deploys.** A `library/skills/<x>/` folder no purpose or
  ambient references is dormant.
- **External ACLs stay external.** Declaring an OKF repo or marketplace does not grant a person's
  GitHub account access to it; tenant admins must manage those permissions separately.
- **Structure only.** `deploy` never touches business *rows* — it provisions/overwrites table
  definitions and PERMISSIONS from the graph, but data stays untouched (and a removed bucket's
  tables are never dropped). Safe by design.
