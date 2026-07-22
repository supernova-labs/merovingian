---
name: merovingian
description: Onboarding and operations guide for a Merovingian tenant. Teaches the mental model (the purpose-graph as desired state, build vs deploy, the graph.yaml shape) and the CLI (init, deploy plan/apply, reset). Use when operating a tenant or unsure which command to run.
allowed-tools: Bash, Read
---

# merovingian — start here

The umbrella skill for operating a Merovingian tenant. Use it when you're new to a tenant repo,
forgot which command does what, or need the mental model before touching the graph. It teaches the
model and routes you to the action; the `architect` agent drives changes end-to-end.

Assumes the `merovingian` CLI is installed (`merovingian help` works). If it isn't, install it from
a checkout of the Source repo (`supernova-labs/merovingian`) — the entrypoint is directly executable:

```bash
cd /path/to/merovingian && bun install
chmod +x bin/merovingian.ts
ln -sf "$PWD/bin/merovingian.ts" ~/.bun/bin/merovingian
```

(No Source checkout on this machine? Ask the human where it lives, or fall back to
`bun /path/to/merovingian/bin/merovingian.ts <command>`.)

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
- **the library** — the tenant's first-party skill/agent prompts: `library/skills/<name>/SKILL.md`
  and `library/agents/<name>.md`. Skills and agents are **local by default**: a bare name
  (`skills: [route]`, `agent: shell`) resolves from the library by convention, no catalog entry.
  External plugins are the exception, always explicit: `audit: compliance@guild` in the `skills:`
  catalog, `agent: counsel@guild` inline — with the marketplace registered in `marketplaces:`
  (optional, external channels only). Library content is desired state too: `deploy` ships it,
  `build` materializes each person's slice into `.claude/skills/` + `.claude/agents/`.

Two operations over that graph:

- **build** (`merovingian build <ns>`) — *projection*: materialize the scoped workspace a person is
  entitled to (their `CLAUDE.md`, `.mcp.json`, `.claude/settings.local.json`, buckets, and their
  library slice — `.claude/skills/` + `.claude/agents/` are wiped and rebuilt each build).
- **deploy** — *reconciliation*: make Surreal match `graph.yaml` + `library/`.

## The commands

| Goal | Command |
|---|---|
| Scaffold a new tenant repo (graph + seeded library) | `merovingian init <tenant> --owner <id> --github <login>` |
| Audit drift (read-only) | `merovingian deploy plan` |
| Converge the db to the graph — first run included | `merovingian deploy apply` *(bootstraps a virgin db; add `--yes` to allow deletions)* |
| Hard-reset a **dev/test** db (wipe structure + reproject) | `merovingian reset` *(from the tenant repo; reads `./graph.yaml`; never on a live tenant)* |
| Refresh the seeded library from the Source templates | `merovingian library update` *(audit-first; `--yes` applies)* |
| Verify enforcement on a bucket table | `merovingian data <ns> <table>` *(rows the logged-in user can see — the db decides)* |
| Drain the learning inbox (governance) | `merovingian inbox <ns> [--all] [--drain [--ids a,b]]` *(root-only; the `drain` skill is the full pass)* |
| Triage a friction's scope (ADR 0014) | `merovingian inbox <ns> --rescope <id> --to <purpose\|root>` *(send it to a purpose's local queue — the tenant's `pending` skill resolves there — or fish it back up)* |
| Drain the decision log (governance) | `merovingian decisions <ns> [--all] [--drain [--ids a,b]]` *(root-only; promotion candidates for `decisions/`)* |
| Inspect the whole tenant graph | `merovingian console <ns>` *(read-only god-view UI)* |

Authoring commands (`deploy`, `reset`, `library update`) read the graph from `./graph.yaml` +
its sibling `library/` (run them **inside the tenant repo**) or `--graph <path>`; the namespace
comes from the yaml.

## The loop (how to make a change)

1. **Edit `graph.yaml` and/or `library/`** — add/change/remove a purpose, bucket, or assignment,
   or edit a skill/agent prompt. Content edits flow through the same loop.
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
  members: `deploy apply` ships the content, and each affected person's next `build` rebuilds
  their `.claude/skills/` + `.claude/agents/` (wiped every build — never hand-edit them).
- **Only referenced library content deploys.** A `library/skills/<x>/` folder no purpose or
  ambient references is dormant.
- **Structure only.** `deploy` never touches business *rows* — it provisions/overwrites table
  definitions and PERMISSIONS from the graph, but data stays untouched (and a removed bucket's
  tables are never dropped). Safe by design.
