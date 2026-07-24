# Operating a tenant — the runbook

The canonical lifecycle to stand up and run a **real** tenant. This is the operator's ground truth:
the order of steps, where each command runs, and — critically — **where files land**. Read it before
touching a production namespace.

Every factual claim here is drawn from `src/commands/` and `src/graph/apply.ts`. For the fixture
walkthrough with no real data, see [`getting-started`](./getting-started.md).

## The two locations you must not confuse

Merovingian works across **two separate folders**. Keeping them apart is the whole runbook:

1. **The tenant repo** — the folder that holds `graph.yaml` and `library/` (created by `init`).
   Authoring commands (`deploy plan`, `deploy apply`, `reset`, `library update`) run **here** and
   read `./graph.yaml` plus its sibling `library/`. The namespace comes from the yaml.
2. **A workspace folder** — a **separate, empty** directory you own. `build` runs **here** and
   materializes the projected workspace **into the current working directory** (`process.cwd()`).

> **`build` does NOT run inside the tenant repo.** It writes `CLAUDE.md`, `.mcp.json`,
> `.claude/settings.local.json`, `.claude/skills/` + `.claude/agents/` (the materialized library
> slice), `.merovingian/build.json`, and `context/<bucket>` symlinks into whatever directory you
> are standing in. Run it from a fresh workspace folder — never the tenant repo, never the Source
> repo. (Source: `src/commands/build.ts`, `target = process.cwd()`.)

## The invocation

Merovingian is not a global binary yet (see [CLI reference](../reference/cli.md#invocation)). This
runbook writes `merovingian <command>`; if you have not installed it (see the CLI reference), substitute
`bun /path/to/merovingian/bin/merovingian.ts`.

## The lifecycle at a glance

```
connect → (init) ──▶ deploy plan ──▶ deploy apply ──▶ login ──▶ build
 secrets  scaffold      audit          converge        auth     workspace
                      (read-only)    (first run too;  (session)  (in a
                                      --yes gates                 SEPARATE folder)
                                      deletes)
```

`init` is one-time setup; `deploy plan`/`deploy apply` are both the first-run projection and the
recurring change loop; `login`/`build` are what each **person** on the tenant runs to get a
workspace.

---

## 1. Connect (secrets)

Every command that touches the database reads its connection from the environment, defaulting to the
local docker compose values (`ws://localhost:8020/rpc`, `root/root`, ns `merovingian`, db =
namespace). For a real tenant, point these at your SurrealDB **before** running anything:

```bash
export SURREAL_URL=wss://db.example/rpc
export SURREAL_USER=...
export SURREAL_PASS=...
# SURREAL_NS defaults to "merovingian"; SURREAL_DB defaults to the tenant namespace.
```

Full details live in [`connection-and-secrets`](./connection-and-secrets.md) and
[`reference/env-vars`](../reference/env-vars.md) — do not duplicate secrets handling in the runbook.
For a local database, `bun run db:up` gives you the defaults for free.

## 2. Scaffold the tenant repo (`init`, once)

Skip this if the tenant repo already exists. `init` writes files only — it does **not** provision the
database.

```bash
merovingian init acme --owner ada --github ada-gh
cd acme
```

This creates the `acme/` **subfolder** with `graph.yaml` (a minimal valid graph: a root shell
purpose with `agent: shell` + `skills: [route]`, ambient `[journal, friction]`, the owner),
`.claude/settings.json` (the `merovingian` marketplace + the `governance` plugin), `README.md`,
`.gitignore`, **and the seeded `library/`** — copies of the Source templates, yours to evolve:
`agents/shell.md`, `skills/journal/{SKILL.md,format.md,context-gaps.md}`,
`skills/friction/{SKILL.md,format.md}`, `skills/route/SKILL.md` — then runs `git init`. `--owner`
and `--github` are both required. The tenant is **fully self-contained** (ADR 0012): every baseline
skill/agent resolves from the library by convention — no `marketplaces:` section, no external
repos. It refuses if the target dir exists and is non-empty. (Source: `src/commands/init.ts`,
`src/init/templates.ts`.)

Later, pull newer Source templates into the seeded files with `merovingian library update`
(audit-first; `--yes` applies; only template-owned paths are touched — see the
[CLI reference](../reference/cli.md#library-update---graph-path---yes)).

From here on, authoring commands run **inside this repo**.

## 3. First-run projection (`deploy apply`)

There is no separate bootstrap command. On a virgin database `deploy apply` does it all: it
ensures the engine schema, plans against the empty state (everything is a create), and converges —
no `--yes` needed, since a first run deletes nothing. Requires a reachable SurrealDB.

```bash
# inside the tenant repo (reads ./graph.yaml; namespace from the yaml)
merovingian deploy apply
```

> For dev/test there is also `merovingian reset` — wipe the structural tables and reproject
> (runtime/business data survives, the inbox included). **Never run it on a live tenant.**
> `deploy apply` is the only reconciliation verb. Source: `src/graph/apply.ts` —
> `reset` = `applyGraph(reset:true)`, `deploy apply` = `applyGraph(reset:false)`.

## 4. Audit (`deploy plan`)

Read-only. Validates the yaml, diffs the desired graph against live Surreal (field-level), and does a
best-effort `gh` existence check of referenced repos. Nothing is applied.

```bash
merovingian deploy plan
echo $?
```

**Exit codes** (`src/commands/deploy.ts`):

| Exit | Meaning | Action |
|---|---|---|
| `0` | In sync — zero drift | Nothing to do. |
| `1` | Drift pending | Review the diff, then `deploy apply`. |
| `2` | `graph.yaml` invalid | Fix the authoring errors; nothing was touched. |

The `gh` repo check is **skipped, not failed**, if `gh` is unavailable or unauthenticated — it never
affects the exit code. Treat missing repos as a manual checklist item.

**Always plan before apply.** The plan is the review.

## 5. Converge (`deploy apply`)

Applies the plan: upsert desired records → reconcile edges → delete removed records. Structure only,
idempotent.

Apply also **provisions the tenant's domain schema** from the graph (ADR 0011):
every `backend: surreal` bucket's tables get a generated `DEFINE TABLE OVERWRITE … SCHEMALESS` +
PERMISSIONS derived from the bucket declaration — idempotent, regenerated on every apply
(`src/graph/apply.ts`, `ensureDomainSchema`). The generator **never drops a table**: removing a
bucket only removes the graph record, and the plan prints
`note: removing a bucket does NOT drop its Surreal tables — the data stays until removed manually.`

```bash
merovingian deploy apply           # no deletions expected
merovingian deploy apply --yes     # explicitly allow deletions
```

Two safety gates (`src/graph/apply.ts`):

- **`--yes` gates deletions.** Any pending deletion — record *or* edge — without `--yes` returns
  `needs-confirm` and applies **nothing** (exit `1`). This is deliberate: deletes are the dangerous
  operation, so they require an explicit second run.
- **Blocked deletes abort atomically.** Before deleting, apply runs a referrer check against live
  runtime rows (today: `inbox.user → user`). If any delete is blocked, apply aborts **before writing
  anything** (status `blocked`, exit `1`) — zero partial state. Re-point or remove the referrer, then
  retry.

**Exit codes:** `0` applied · `1` needs-confirm or blocked · `2` invalid yaml.

The change loop (edit → plan → apply, rename semantics, invariants) has its own guide:
[`authoring-the-graph`](./authoring-the-graph.md).

## 6. Log in (per person)

Each person who wants a workspace authenticates once per machine. The session is stored at
`~/.merovingian/<ns>/currentuser.json`. (Source: `src/commands/login.ts`.)

```bash
# Remote tenant (a build/auth service is registered) — identity comes from GitHub:
merovingian namespace add acme https://build.acme.example   # once, registers the remote
merovingian login acme                                      # uses your gh auth token

# Local tenant, password SIGNIN (ADR 0015) — the person's own credential:
#   operator, once: openssl rand -base64 18 | merovingian passwd acme ada
#   person's workspace .env: MEROVINGIAN_USER=ada + MEROVINGIAN_PASS=<their password>
merovingian login acme ada        # SurrealDB checks the hash, issues the token — no system creds

# Local tenant, operator convenience (system creds in env, no password set):
merovingian login acme ada                     # validates against the live deployed db
```

- **Remote** path (`namespace add` done): omit the user; the CLI uses `gh auth token` and the
  service's `/whoami` to resolve you. Requires `gh auth login`.
- **Password** path (`MEROVINGIAN_PASS` set): the login authenticates AS the person via the
  identity SIGNIN — no root/system credential on their machine, and the MCPs and `data`
  authenticate the same way from the workspace `.env`. This is the per-person path for a real
  tenant without a service. Onboarding order: `deploy apply` (the user exists in the graph) →
  `passwd` (operator) → `.env` (person) → `login`.
- **Local operator** path (no password in env): the `<user>` positional is required and must be a
  user id in the graph; resolution uses the system connection. Backend selection mirrors `build`
  (`--backend` / `MEROVINGIAN_BACKEND`, default `surreal`) — the default hits the live deployed
  db, which is what a real tenant needs. Do **not** set `--backend stub` here: the stub only knows
  the `acme` fixture, so a real tenant fails with `unknown namespace "<ns>" (known: acme)`.

`build`, `graph`, and `data` all fail with `not logged in to "<ns>"` until this succeeds.

## 7. Build the workspace (per person, in a SEPARATE folder)

This is the step most likely to be done wrong. `build` writes into the **current working directory**
and **requires a prior login**. Stand in a fresh, empty folder you own:

```bash
mkdir -p ~/workspaces/ada-acme
cd ~/workspaces/ada-acme                 # NOT the tenant repo, NOT the Source repo
merovingian build acme                      # against the live deployed graph (default backend)
merovingian build acme --purposes content   # narrow to a subset
```

It materializes into the cwd:

| File | What it is |
|---|---|
| `CLAUDE.md` | The workspace index a human/agent reads. |
| `.mcp.json` | Tools, by name. |
| `.claude/settings.local.json` | Generated, disposable per-build config. |
| `.claude/skills/<name>/*` | This person's slice of the tenant library — skill content materialized from the manifest. |
| `.claude/agents/<name>.md` | Library agents of the visible purposes. |
| `.merovingian/build.json` | Stamp: what built this folder. |
| `context/<bucket>` | Symlinks to the entitled okf repos (cloned/pulled into the central store `~/merovingian/<ns>/repos`). |

> `.claude/skills/` and `.claude/agents/` are **wiped and rebuilt from the manifest on every
> build** — stale content from a broader entitlement cannot survive a rebuild, and hand-edits
> there are lost. Members get their library slice from the build; they never need read access to
> the tenant repo.

Open that folder in Claude Code and the projected workspace is live. Rebuild any time the graph
changes — `build` is a projection, safe to re-run.

## 8. Verify enforcement (optional)

For sensitive, `surreal`-backed, row-scoped buckets, confirm the backend actually gates rows per
identity — `data` takes any bucket table (the engine knows no domain table names):

```bash
merovingian data <ns> <table>     # lists only what the logged-in user may see (enforced by Surreal PERMISSIONS)
merovingian data acme client      # e.g. the fixture's clients bucket
```

See [`enforcement`](../concepts/enforcement.md) — *generation ≠ enforcement*: the build projects the
scope; the database honors it.

## 9. Inspect the whole graph (operator)

```bash
merovingian console acme     # read-only, no-auth god-view at http://127.0.0.1:8888 (backend: surreal)
```

Bound to `127.0.0.1` only. Use it to see the full tenant graph while operating.

## 10. Governance — local (`pending`) and root (drain)

As people work, the ambient `journal`/`friction` tools append learnings and snags to the tenant's
**inbox**, and the ambient `decisions` MCP (`register-decision`) appends the calls they made with
no policy behind them to the **decision log**.

**Frictions are scoped (ADR 0014).** The writer says whose problem it is at birth: their own
purpose (its mounts can fix it), an ancestor (needs wider reach — escalation happens at creation),
or nothing = the root queue. Members read and resolve **within the real reach of their lineage**
— the db filters, never the self-declared `origin`. The local half of governance is the tenant's
**`pending` skill**, run in a workspace **when the human asks** (never spontaneously): list the
reach's pending frictions (`pending` tool), fix the operational ones with the mounts at hand,
stamp them with a `resolved_through` trace (`resolve` tool), hand off within reach (`rescope`),
leave the structural for root. Journals stay unscoped — root's narrative material.

**The root pass** sees everything (the synoptic view: three local frictions can be one systemic
tension). Periodically, drain:

```bash
merovingian inbox acme                    # undrained entries (scope visible), oldest first
merovingian inbox acme --rescope a1 --to eventos   # triage: a local problem goes down
merovingian inbox acme --drain            # after processing: stamp them drained
merovingian inbox acme --drain --ids a,b  # partial pass: only what was covered

merovingian decisions acme                # in-flight decision log: domain, author, applied records
merovingian decisions acme --drain        # after processing: stamp them drained
```

Each decision-log entry shows the ratified records it applied (`applies: decision:…`) — the
jurisprudence telemetry the pass reads: many citations = load-bearing, zero = dead letter.

The full choreography is the governance plugin's **`drain` skill** (the architect drives it): a
`governance/<date>` branch → cluster the entries into tensions → discuss them with the human one
at a time → turn the agreed ones into graph/library changes through the normal plan/apply loop →
**promote converged decisions into ratified records** (`decisions/<domain>/NNNN-slug.md` in the
tenant repo — they ship on the same `deploy apply`; an `accepted` record is immutable, supersede
it instead of editing) → stamp both drains → commit; with a remote, it asks before opening a PR.
The pass also **triages by scope**: what's structural it keeps, what's operational it re-scopes
down, and it closes reporting where local queues stand ("N frictions await local governance in
X" — a recommendation, not an obligation). Drained means "someone saw it and gave it a
destination" — this drain or a local `pending` pass — and entries are never deleted (`--all`
audits the history, `resolved_through` carries each local resolution's trace).

---

## Recurring loop, once you're live

1. Edit `graph.yaml` **and/or `library/`** in the tenant repo (in a PR — structure and prompts
   version together, atomically).
2. `merovingian deploy plan` — review the diff (exit `1` = drift, `2` = invalid). Content changes
   show as per-file hash scalars (e.g. `files.SKILL.md: 6ecffe0c → e0bd1151`) — the reviewable full
   diff is the PR itself.
3. `merovingian deploy apply` (add `--yes` to allow deletions). Surreal buckets **provision** their
   tables + PERMISSIONS on every apply (regenerated, idempotent); a removed bucket **never drops**
   its tables — the plan prints a note and the data stays until removed manually.
4. Affected people re-run `merovingian build <ns>` in their workspace folder — that is also how
   library content updates propagate.
5. After a clean apply, **commit** — the diff is the change record (the architect agent does this
   unprompted).

Occasionally, `merovingian library update` to refresh the seeded library files from newer Source
templates (audit-first; `--yes` applies) — and a **governance pass** (§10) to drain what
accumulated in the inbox and the decision log back into structure and jurisprudence.

Never `reset` a live tenant — it wipes the structural tables with no plan and no gates. There is
no case for it outside dev/test; `deploy apply` is the only reconciliation verb, first run
included.

## Related

- [`authoring-the-graph`](./authoring-the-graph.md) — the change loop and graph invariants.
- [`connection-and-secrets`](./connection-and-secrets.md) — reaching SurrealDB and gh.
- [`going-to-production`](./going-to-production.md) — remote service, real gh-auth, secrets.
- [`reference/cli`](../reference/cli.md) — every command and flag.
- [`reference/machine-layout`](../reference/machine-layout.md) — `~/.merovingian/` and `~/merovingian/`.
- [`concepts/build-vs-deploy`](../concepts/build-vs-deploy.md) · [`concepts/topology`](../concepts/topology.md).
