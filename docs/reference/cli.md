# CLI reference

The complete `merovingian` command surface. Grounded in `src/cli.ts` (dispatch, `USAGE`,
`extractFlags`) and `src/commands/`.

## Invocation

Merovingian runs on **Bun** (>= 1.3). Three supported ways to run it:

```bash
# 1. Installed (npm) — the normal way:
bun add -g @supernova-labs/merovingian
merovingian <command> [args]

# 2. Zero-install, per call:
bunx @supernova-labs/merovingian <command> [args]

# 3. From a source checkout (contributors):
bun bin/merovingian.ts <command> [args]
# optional: put the checkout on PATH (dev symlink)
chmod +x bin/merovingian.ts && ln -sf "$PWD/bin/merovingian.ts" ~/.bun/bin/merovingian
```

Throughout this doc commands are written as `merovingian <command>`. The other two entrypoints,
`bin/merovingian-console.ts` and `bin/merovingian-service.ts`, are run via `bun run console` /
`bun run service` from a checkout (see [Servers](#servers)).

## Two families: authoring vs runtime

| Family | Commands | Where the target comes from |
|---|---|---|
| **Authoring** | `init`, `deploy plan`, `deploy apply`, `reset`, `library update` | Read the graph from `--graph <path>` or `./graph.yaml` in the cwd (plus its sibling `library/`). **The namespace comes from the yaml** (`namespace:` field). |
| **Runtime** | `login`, `graph`, `build`, `data`, `passwd`, `inbox`, `decisions`, `console` | Take a `namespace` **positional** argument (selects the SurrealDB / offline stub). Exception: `passwd` is **Surreal-only** (credentials live in the db; there is no stub backend for it). |

`init` is a special case: it takes a `<tenant>` positional (the name of the repo to scaffold), not a
graph — it *creates* the graph and seeds the library.

See [`build-vs-deploy`](../concepts/build-vs-deploy.md) for the conceptual split and
[`operating-a-tenant`](../guides/operating-a-tenant.md) for the lifecycle.

## Command matrix

| Command | Reads graph | Positional | Key flags |
|---|---|---|---|
| `version` | — | — | `--version`/`-v` aliases |
| `init <tenant>` | writes one | `<tenant>` | `--owner <id>` `--github <login>` |
| `namespace add <ns> <url>` | — | `<ns>` `<url>` | — |
| `login <ns> [user]` | — | `<ns>` `[user]` | `--backend` |
| `graph <ns>` | — | `<ns>` | `--backend` |
| `build <ns>` | — | `<ns>` | `--purposes` `--backend` |
| `reset` | yes | — | `--graph` |
| `data <ns> <table>` | — | `<ns>` `<table>` | — |
| `passwd <ns> <user>` | — | `<ns>` `<user>` | — (password via `MEROVINGIAN_NEW_PASS` or stdin) |
| `inbox <ns>` | — | `<ns>` | `--all` `--drain` `--ids` `--rescope` `--to` |
| `mcp <name>` | — | `inbox` \| `decisions` \| `surreal-data` | — (stdio server; what the emitted `.mcp.json` invokes) |
| `decisions <ns>` | — | `<ns>` | `--all` `--drain` `--ids` |
| `console <ns>` | — | `<ns>` | `--backend` `--port` |
| `deploy plan` | yes | — | `--graph` |
| `deploy apply` | yes | — | `--graph` `--yes`/`-y` |
| `library update` | locates the tenant repo via it | — | `--graph` `--yes`/`-y` |

## Flags

Parsed by `extractFlags` in `src/cli.ts`. Every flag accepts both the space form (`--graph P`) and
the equals form (`--graph=P`).

| Flag | Applies to | Meaning |
|---|---|---|
| `--version`, `-v` | global | Print the installed CLI version and exit without checking npm for updates. `merovingian version` is equivalent. |
| `--graph <path>` | `reset`, `deploy plan`, `deploy apply`, `library update` | Path to the `graph.yaml`. Default: `./graph.yaml` in the cwd. |
| `--owner <id>` | `init` | Graph id of the founding owner (required). |
| `--github <login>` | `init` | GitHub login of the founding owner (required). |
| `--purposes a,b,c` | `build` | Comma-separated subset of accessible purposes to narrow the projection to. |
| `--backend stub\|surreal` | `login`, `graph`, `build`, `console` | Backend. Default `surreal` (the live db) for all; `stub` is the offline `acme` fixture. |
| `--port <n>` | `console` | Console port. Default `8888` (env `CONSOLE_PORT`). |
| `--yes`, `-y` | `deploy apply`, `library update` | `deploy apply`: confirm deletions (without it, any pending deletion aborts as `needs-confirm`). `library update`: apply the template refresh (without it, audit only). |
| `--all` | `inbox`, `decisions` | Also show already-drained entries (audit the history). |
| `--drain` | `inbox`, `decisions` | Stamp entries `drained = time::now()` (all undrained, or only `--ids`). |
| `--ids a,b` | `inbox`, `decisions` | Narrow `--drain` to specific entry ids. Rejected without `--drain`. |
| `--rescope <id> --to <purpose\|root>` | `inbox` | Triage (ADR 0014): move a friction to a purpose's local queue, or back to the root queue. |

---

## Commands

### `init <tenant> --owner <id> --github <login>`

Scaffold a new tenant repo (files only — it does **not** provision the database). Creates the
**`<cwd>/<tenant>/` subfolder** (announced before writing), then runs `git init`. Fails if the
target dir exists and is non-empty. `--owner` and `--github` are required. Source:
`src/commands/init.ts`, `src/init/baseline.ts`, `src/init/templates.ts`.

Files written:

- `graph.yaml` — a minimal, valid, **fully self-contained** graph (ADR 0012): root purpose with
  `agent: shell` and `skills: [route]`, ambient
  `[journal, friction, pending, update-workspace]`, no `marketplaces:` section —
  every skill/agent resolves from the seeded library by convention.
- `library/` — the **seeded tenant library**: copies of the Source templates, the tenant's to
  evolve: `agents/shell.md`, `skills/journal/{SKILL.md,format.md,context-gaps.md}`,
  `skills/friction/{SKILL.md,format.md}`, `skills/pending/SKILL.md`,
  `skills/update-workspace/SKILL.md`, `skills/route/SKILL.md`, plus tenant-owned
  `workspace.md` with global guardrails. The latter reaches every member and must contain no
  secrets or audience-specific context.
- `.claude/settings.json` — the committed repo config: the `merovingian` marketplace + the
  `governance@merovingian` plugin (repo tooling, ADR 0010).
- `README.md`, `.gitignore`.

```bash
merovingian init acme --owner ada --github ada-gh
```

Refresh the seeded library files from newer Source templates later with
[`library update`](#library-update---graph-path---yes). It never manages `workspace.md`.

### `namespace add <namespace> <url>`

Register a namespace as served by a **remote** build/auth service. After this, `login`/`build`/`graph`
for that namespace go over HTTP instead of hitting a local backend. Writes
`~/.merovingian/<ns>/namespace.json`. Source: `src/commands/namespace.ts`, `src/transport.ts`.

```bash
merovingian namespace add acme https://build.acme.example
```

### `login <namespace> [user]`

Authenticate against a namespace and store the session at
`~/.merovingian/<ns>/currentuser.json`. Source: `src/commands/login.ts`.

- **Local** (no remote registered): the `[user]` positional is **required** — it is the stand-in
  for the auth result (e.g. `ada`), resolved against the graph. Backend selection mirrors `build`
  (`--backend` / `MEROVINGIAN_BACKEND`, default `surreal`): `surreal` validates against the live
  deployed db, `stub` against the offline fixture.
- **Remote** (namespace registered via `namespace add`): omit `[user]`. Identity comes from GitHub
  — the CLI grabs your `gh auth token`, calls the service's `/whoami`, and stores the resolved
  identity.

```bash
merovingian login acme ada                   # local, live db
merovingian login acme ada --backend stub    # local, offline acme fixture
merovingian login acme                       # remote (gh identity)
```

`build`, `graph`, and `data` all **require a prior `login`** — they read the session file and
throw `not logged in to "<ns>"` if it is missing.

With `MEROVINGIAN_PASS` set, the local-surreal login authenticates by **password SIGNIN**
(ADR 0015): the DB checks the argon2 hash and issues the scoped token — no system credential
needed on the machine. The same variable makes `build` and `graph` connect **as the person**
(ADR 0016): the structural tables are SELECT-scoped by lineage, so the database hands the
provider exactly their slice. Without it, the legacy operator path uses the system connection.

### `passwd <namespace> <user>`

Operator surface: set or rotate a person's SIGNIN password (ADR 0015). Connects with the system
credential (Surreal-only — no stub), verifies the user exists in the graph, and upserts the argon2
hash into the runtime `credential` table. Credential lifecycle: re-projections never wipe passwords
(`reset` and routine applies leave `credential` rows alone), but **removing a user from the graph
removes their credential with them** (`deploy apply --yes` deletes both) — a later user with the
same id never inherits the old password. The new password comes from `MEROVINGIAN_NEW_PASS` or
stdin (piped or typed; minimum 8 characters). Source: `src/commands/passwd.ts`.

```bash
# generate AND capture — a bare `openssl | passwd` pipe would set a password nobody ever saw:
PW=$(openssl rand -base64 18); echo "hand over securely: $PW"
MEROVINGIAN_NEW_PASS="$PW" merovingian passwd acme ada; unset PW
```

Full runbook (both sides, copy-paste for the member):
[onboarding-a-member](../guides/onboarding-a-member.md).

### `graph <namespace> [--backend stub|surreal]`

Print the logged-in user's full personal access graph: visible purposes, okf/surreal buckets,
tools, plugins. A dry-run projection (full entitlement) — **no files written**. Default backend
`surreal`. Source: `src/commands/graph.ts`.

```bash
merovingian graph acme
```

### `build <namespace> [--purposes a,b] [--backend stub|surreal]`

Project the scoped Claude Code + Codex workspace the logged-in user is entitled to. **Requires a prior
`login`** (reads the session file first) and **materializes into the current working directory**
(`target = process.cwd()`) — it does *not* build inside the tenant repo. Run it from an empty
workspace folder you own. Source: `src/commands/build.ts`, `src/projection/emit.ts`.

Writes into the cwd:

- `CLAUDE.md` — the workspace index.
- `.mcp.json` — tools by name.
- `.claude/settings.local.json` — generated, disposable per-build config.
- `.claude/skills/<name>/*` — the library skills this identity carries, materialized from the
  manifest (ADR 0012).
- `.claude/agents/<name>.md` — the library agents of the visible purposes.
- `AGENTS.md`, `.agents/skills/<name>/*` and the Codex-native agent projection:
  `.codex/config.toml` declares each `[agents.<name>]`, whose `config_file` references
  `.codex/agents/<name>.toml`.
- `.merovingian/build.json` — schema-3 per-emitter ownership, explicit degradation records, and
  `requestedPurposes` (`[]` means full entitlement; a non-empty array preserves the original
  normalized `--purposes` request).
- `context/<bucket>` — symlinks to the entitled okf repos (cloned/pulled into the central store).

> **Ownership semantics:** emit removes stale files only when they appear in the previous
> per-emitter inventory. It preserves unowned siblings and refuses to overwrite foreign root/config
> files. Generated files should not be hand-edited. (Source: `src/projection/emit.ts`.)

On first use, trust the generated workspace when Codex prompts. Codex does not load the local
`.codex/config.toml` before that exact workspace is trusted; projected MCP servers and OKF
permissions therefore become active only after this one-time user gate.

When Codex plugins are absent, build prints a warning and still succeeds. Reconcile them explicitly:

```bash
merovingian plugins sync
```

Company-key MCP values are written only to mode-0600 local harness configs. A build carrying such
values refuses to target any folder inside a Git repository.

`--purposes` narrows the build to a subset of accessible purposes. Default backend `surreal`.

```bash
cd ~/workspaces/ada-acme     # an empty folder you own — NOT the tenant repo
merovingian build acme
merovingian build acme --purposes content
```

The ambient `update-workspace` skill uses this receipt to reproduce the same build later. Invoke
it explicitly as `/update-workspace` in Claude or `$update-workspace` in Codex (also discoverable
through Codex's `/skills` picker). It checks the active identity and dirty `context/` repos, shows
the planned global CLI update and rebuild, and asks once before changing the machine. Schema-2
receipts remain readable by the CLI, but the skill asks for the old purpose selection rather than
guessing or silently widening to full entitlement. A successful new build promotes the receipt to
schema 3.

The skill leaves plugin reconciliation explicit, does not edit generated files by hand, and does
not remove stale context symlinks. A denied context mount makes the refresh partial and is reported
as such. A clean but divergent checkout is mounted as stale and reported separately; dirty or
inaccessible checkouts are not mounted. Start a new agent session after it completes so rebuilt
instructions and capabilities load.

### `reset [--graph <path>]`

**Dev/test only.** Reset the namespace (taken from the yaml) to the graph: ensure schema, **wipe
the structural tables**, project — no plan, no gates. Touches only structural tables — never
runtime/business data (the inbox survives). **Never run it on a live tenant**: it discards the
live structure without confirmation. The first run does not need it either — `deploy apply`
bootstraps a virgin db by itself. Requires a reachable SurrealDB. Source:
`src/commands/reset.ts`, `src/graph/apply.ts` (`reset: true`).

```bash
merovingian reset                                   # reads ./graph.yaml
merovingian reset --graph fixtures/example/graph.yaml
```

### `data <namespace> <table>`

Connect to Surreal **as the logged-in user** (a scoped JWT identity, subject to record-level
PERMISSIONS) and list the rows of `<table>` they can actually see
(`SELECT * FROM type::table($t) LIMIT 20`). A live enforcement preview — the backend decides.
**Requires a prior `login`.** Generic on purpose (ADR 0011): the engine knows no domain table
names — the table is any surreal-bucket table the graph declares (it must be a safe identifier, or
the command throws `"<table>" is not a safe table name`). Empty output prints
`(none — blocked by the backend, or the table is empty)`. Source: `src/commands/data.ts`. See
[`enforcement`](../concepts/enforcement.md).

```bash
merovingian data acme client
```

Demo rows for the `acme` fixture's `client` table come from `bun run seed:acme`
(`fixtures/example/seed.ts` — fixture domain data, not an engine command).

### `inbox <namespace> [--all] [--drain [--ids a,b]] [--rescope <id> --to <purpose|root>]`

The **governance drain surface** (root-only — it connects with the Surreal root credentials, not
a scoped identity; root sees EVERYTHING, including the unscoped root queue). Lists the undrained
learning-inbox entries — journal/friction appended by members' ambient tools — oldest first, full
text, ids and `scope` visible; `--drain` stamps them `drained = time::now()`; `--rescope` is the
triage hand (ADR 0014): send a friction down to a purpose's local queue ("não sou eu que
resolvo") or fish one back up with `--to root`. Entries are **never deleted**: drained means
"someone saw it and gave it a destination" (this drain or a local `pending` pass — the trace
lands in `resolved_through`), and `--all` audits the history.
Source: `src/commands/inbox.ts`. The full governance pass is the plugin's `drain` skill; the
local half is the tenant's `pending` skill over the inbox MCP.

```bash
merovingian inbox acme                       # undrained entries
merovingian inbox acme --all                 # include drained history
merovingian inbox acme --drain               # stamp everything undrained
merovingian inbox acme --drain --ids a1,b2   # stamp only these (partial pass)
merovingian inbox acme --rescope a1 --to content   # triage: content's problem now
merovingian inbox acme --rescope a1 --to root      # fish it back to the root queue
```

```
inbox · acme — 2 undrained entries

── inbox:c6wf60ay… · journal · cleo · 2026-07-02T20:29:37.629Z
learned X

── inbox:gcsw4l77… · friction · cleo · 2026-07-02T20:29:37.634Z
got stuck on Y
```

Exit `0` on success, `1` on a thrown error (like `data`). Older dbs that predate the `drained`
field are safe: the list works regardless, and the `--drain` write path re-asserts the engine
schema first (SCHEMAFULL would otherwise drop the write silently).

### `decisions <namespace> [--all] [--drain [--ids a,b]]`

The **decision-log drain surface** (root-only) — the inbox's sibling, for the in-flight decision
log (ADR 0013). Lists the undrained `decision_log` entries — calls members registered mid-work via
the ambient `decisions` MCP (`register-decision`) — oldest first, with the domain, the author, the
full text, and the ratified records each one applied (`applies: decision:…` — the jurisprudence
telemetry the drain pass reads: many citations = load-bearing, zero = dead letter). `--drain`
stamps them `drained = time::now()`; entries are **never deleted**, `--all` audits the history.
Source: `src/commands/decisions.ts`. The promotion choreography (log → ratified record in
`decisions/`) is the plugin's `drain` skill.

This command touches only the **log**. The ratified records themselves are authored as files in
the tenant repo's `decisions/<domain>/` and shipped by `deploy` — see the [`graph.yaml`
reference](./graph-yaml.md#the-tenant-decisions-decisions).

```bash
merovingian decisions acme                       # undrained log entries
merovingian decisions acme --all                 # include drained history
merovingian decisions acme --drain               # stamp everything undrained
merovingian decisions acme --drain --ids a1,b2   # stamp only these (partial pass)
```

```
decision log · acme — 1 undrained entry

── decision_log:9k2m1xa… · pricing · cleo · 2026-07-03T14:02:11.000Z
   applies: decision:pricing/0001-enterprise-floor
held the 20k floor on the vertex deal; approved an 8% discount within sales authority
```

Exit `0` on success, `1` on a thrown error, like `inbox` — and the same older-db safety: the
`--drain` write path re-asserts the engine schema first.

### `console <namespace> [--backend stub|surreal] [--port <n>]`

Serve the Architect console — a **local, read-only, no-auth god-view** of the whole tenant graph.
Binds to `127.0.0.1` only. Like every runtime command, it defaults to the `surreal` backend (the
real deployed graph); pass `--backend stub` or `MEROVINGIAN_BACKEND=stub` for the offline fixture.
Default port `8888` (env `CONSOLE_PORT`). Source: `src/cli.ts`, `src/server/console.ts`.

Three views: **Tree** (purposes + detail), **Graph** (force layout with a people-layer control —
toggle all people or individuals off to read the purpose structure alone), and **Inbox** (every
journal/friction entry, drained included, filterable — the read side of `merovingian inbox`;
draining stays with the CLI). Endpoints: `GET /graph`, `GET /inbox` (both god-view; the stub
backend serves an empty inbox).

```bash
merovingian console acme
merovingian console acme --backend stub --port 9000
```

### `deploy plan [--graph <path>]`

Read-only audit: validate the yaml → diff the desired graph against live Surreal → best-effort `gh`
existence check of referenced repos. Nothing is applied. Source: `src/commands/deploy.ts`,
`src/graph/plan.ts`, `src/graph/external-check.ts`.

Desired state includes `library/workspace.md`. Its content appears only as a short
`config.instructions` hash in the plan; the full review remains the tenant-repo diff.

The **external `gh` check** (okf-repo bucket repos + marketplace repos) is skipped — not failed — if
`gh` is not installed or not authenticated. The deterministic Surreal diff is the spine; the gh
check is a bonus signal and never affects the exit code.

**Exit codes:**

| Exit | Meaning |
|---|---|
| `0` | In sync — zero drift. |
| `1` | Drift pending (the plan is non-empty). |
| `2` | `graph.yaml` invalid (authoring errors). |

```bash
merovingian deploy plan
echo $?     # 0 / 1 / 2
```

### `deploy apply [--graph <path>] [--yes]`

Converge Surreal to the graph: upsert desired records → reconcile edges → delete removed records.
Structure only, idempotent, referrer-safe. It also **bootstraps a virgin db** (first run included):
it ensures the engine schema, and against an empty db the plan is all-creates, so it converges
without `--yes`. Source: `src/commands/deploy.ts`, `src/graph/apply.ts` (`reset: false`).

- **Deletions are gated by `--yes`.** Any pending deletion (record *or* edge) without `--yes`
  returns `needs-confirm` and applies nothing.
- **Blocked deletes abort atomically.** Before deleting, apply runs a referrer check against live
  runtime rows (today: `inbox.user → user`). If any delete is blocked by live data, apply aborts
  **before writing anything** — zero partial state. Re-point or remove the referrer, then retry.

**Exit codes:**

| Exit | Meaning |
|---|---|
| `0` | Applied. |
| `1` | `needs-confirm` (deletes pending, no `--yes`) **or** `blocked` (delete blocked by live data). |
| `2` | `graph.yaml` invalid. |

```bash
merovingian deploy apply           # no deletions, or refuses with exit 1
merovingian deploy apply --yes     # allow deletions
```

### `library update [--graph <path>] [--yes]`

Authoring command (runs in the tenant repo — it locates the repo via the graph path). Refresh the
tenant's **seeded** library files from the Source templates, audit-first: without `--yes` it only
shows the diff; with `--yes` it overwrites. It considers **template-owned paths only** — files that
exist in `src/init/templates/library/` — so tenant-authored skills/agents/files are never touched.
`library/workspace.md` is created separately by `init`, is never a template-owned path, and remains
untouched even with `--yes`.
Source: `src/commands/library.ts`, `src/init/templates.ts`.

Template additions are copied by `--yes` but are not activated automatically in an existing
tenant's graph. To adopt `update-workspace`, update the admin CLI, run `library update --yes`, add
`update-workspace` to `ambient.skills`, run `deploy apply`, and have members build once. Subsequent
refreshes can use the skill itself.

Output renders one line per template path:

```
library update  (template-owned paths only — your own files are never touched)

  + add       library/skills/journal/context-gaps.md
  ~ overwrite library/skills/route/SKILL.md
  = unchanged library/agents/shell.md
```

The command cannot tell "the tenant evolved this file" from "this file is stale" — **git is the
safety net**: run it in a clean working tree, and an applied overwrite lands as a reviewable,
revertible diff in the tenant repo.

**Exit codes:**

| Exit | Meaning |
|---|---|
| `0` | In sync with the Source templates, **or** `--yes` applied the refresh. |
| `1` | Drift pending (templates differ; nothing was written). |

```bash
merovingian library update          # audit only
merovingian library update --yes    # apply (overwrites local edits to template-owned files)
```

---

## Servers

Run via `package.json` scripts (both bind their own port, log to stderr):

| Script | Entrypoint | What it is |
|---|---|---|
| `bun run console` | `bin/merovingian-console.ts` | Architect console god-view. Default namespace `acme`, backend `surreal` (`MEROVINGIAN_BACKEND=stub` for the fixture), port `8888` (`CONSOLE_PORT`). |
| `bun run service` | `bin/merovingian-service.ts` | Build/auth service. Holds Surreal root creds + JWT signing key server-side; authenticates via the real GitHub API. Default port `8787` (env `PORT`). |

`bun run console` (the standalone entrypoint) does not take a namespace argument — it defaults to
`acme`. To pick a namespace, use the CLI form `merovingian console <ns>` instead.

## Update notice

After a command finishes, the CLI prints one stderr line if npm has a newer version
(`↑ merovingian X.Y.Z available — bun add -g @supernova-labs/merovingian@latest`). The registry is
consulted at most once per 24h (cached in `~/.merovingian/update-check.json`), concurrently with the
command's own work, and any failure (offline, timeout) silently skips the notice. Never shown for
`mcp` (stdout is the stdio protocol), `console`, `help`, or `version`. Opt out with
`MEROVINGIAN_NO_UPDATE_CHECK=1` (also off when `CI` is set).

This notice is passive. In a workspace where the ambient library skill is active, an explicit
`/update-workspace` (Claude) or `$update-workspace` (Codex) performs the guarded update and rebuild.

## Global exit behavior

`bin/merovingian.ts` catches any thrown error, prints its message to stderr, and exits `1`. The
structured exit codes above are set by `deploy plan` / `deploy apply` (`0/1/2`) and
`library update` (`0/1`) via `process.exitCode`; every other command exits `0` on success or `1` on
a thrown error.

## Related

- [`reference/graph-yaml`](./graph-yaml.md) — the graph schema.
- [`reference/env-vars`](./env-vars.md) — `SURREAL_*`, `MEROVINGIAN_*`, `CONSOLE_PORT`, `PORT`.
- [`guides/connection-and-secrets`](../guides/connection-and-secrets.md) — how the CLI reaches SurrealDB and gh.
- [`guides/authoring-the-graph`](../guides/authoring-the-graph.md) — the plan/apply change loop.
