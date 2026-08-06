# Getting started

Run Merovingian end-to-end, locally, using the bundled `acme` example tenant against a local
SurrealDB. About 5 minutes. Everything here uses fixture data (`fixtures/example/graph.yaml` + its
sibling `fixtures/example/library/`, including synthetic tenant-wide `workspace.md` instructions)
— no real tenant.

For standing up a **real** tenant, read [`operating-a-tenant`](./operating-a-tenant.md) instead.
This guide is a first-run tour.

## Prerequisites

- **Bun** ≥ 1.3 (`package.json` engines).
- **Docker** (for the local SurrealDB via `docker compose`).
- Optionally the **`gh` CLI** authenticated — used only for the best-effort repo existence check in
  `deploy plan`; everything works without it.

## 0. Install and run

The published CLI installs with Bun:

```bash
bun add -g @supernova-labs/merovingian    # → the `merovingian` command
```

This guide tours the **bundled example tenant**, which ships with the *source checkout* (not the
npm package) — so it runs commands as `bun bin/merovingian.ts <command>` from the repo root after
`git clone` + `bun install`. If you installed globally, `merovingian <command>` works the same
everywhere a command below says `bun bin/merovingian.ts` (add `--graph fixtures/example/graph.yaml`
where shown).

## 1. Start SurrealDB

```bash
bun run db:up      # docker compose up -d
```

This starts SurrealDB v3 on `ws://localhost:8020/rpc` with `root/root`, namespace `merovingian`
(see `docker-compose.yml`). Those are also the CLI's connection defaults, so no connection env vars
are needed locally. Stop it later with `bun run db:down`.

One secret is required, though: the key your tenant's identity access is provisioned with and that
tokens are signed with. `deploy apply` (next step) refuses to key a tenant to a guessable default, so
set a private one for this session (persist it in your shell profile to keep the db usable later):

```bash
export MEROVINGIAN_JWT_SECRET=$(openssl rand -hex 32)
```

## 2. Project the graph into the database (`deploy apply`)

`deploy apply` converges the database to the graph — and it bootstraps a virgin db by itself: it
ensures the engine schema, and on an empty database the plan is all-creates, so it converges
without `--yes`. The namespace (`acme`) comes from the yaml.

```bash
bun bin/merovingian.ts deploy apply --graph fixtures/example/graph.yaml
```

You should see the create-only diff followed by a line like `✓ applied: +N created · ~0 changed ·
-0 deleted.` (To hard-reset this dev database later — wipe the structural tables and reproject —
there is `bun run reset`; dev/test only.)

## 3. Audit for drift (`deploy plan`)

Right after an apply, the database matches the graph exactly:

```bash
bun bin/merovingian.ts deploy plan --graph fixtures/example/graph.yaml
echo $?     # 0 = in sync
```

Expect `✓ Surreal in sync with graph.yaml — zero drift.` and exit code `0`. Exit `1` would
mean drift, `2` an invalid yaml. See [`build-vs-deploy`](../concepts/build-vs-deploy.md).

## 4. Log in (stub identity)

The `acme` namespace is local (no remote service registered), so `login` takes a stub user id. The
fixture defines `ada`, `ben`, and `cleo`:

```bash
bun bin/merovingian.ts login acme ada --backend stub
```

`--backend stub` selects the offline `acme` fixture — runtime commands default to `surreal` (the
live db). This writes a session at `~/.merovingian/acme/currentuser.json`. `graph`, `build`, and
`data` all require this session to exist.

## 5. Inspect your access graph (`graph`)

```bash
bun bin/merovingian.ts graph acme --backend stub
```

Prints everything `ada` is entitled to — visible purposes, okf/surreal buckets, tools, plugins. No
files are written; this is a dry-run projection.

## 6. Project a workspace (`build`)

`build` **materializes files into the current working directory** and **requires a prior login**.
Do it in a throwaway folder, never in the Source repo:

```bash
mkdir -p /tmp/ada-acme && cd /tmp/ada-acme
bun bin/merovingian.ts build acme --backend stub
```

It writes both native harness projections: Claude Code (`CLAUDE.md`, `.mcp.json`,
`.claude/settings.local.json`, `.claude/skills`, `.claude/agents`) and Codex (`AGENTS.md`,
`.codex/config.toml`, `.agents/skills`, `.codex/agents`). The **materialized library slice** contains
the library skills/agents
`ada`'s purposes carry (content from the fixture's `fixtures/example/library/`, listed file-by-file
in the build output) — `.merovingian/build.json`, and symlinks `context/<bucket>` for the buckets
`ada` can read. Both root instruction files index the same scoped semantics. Narrow it with
`--purposes`:

```bash
bun bin/merovingian.ts build acme --purposes content --backend stub
```

Open `CLAUDE.md` and `AGENTS.md`: both contain the same `Tenant-wide operating instructions`
section sourced from `fixtures/example/library/workspace.md`. The section survives purpose
narrowing because it is ambient; tenant admins propagate edits with `deploy apply`, followed by a
new build on each machine.

On first use, open the generated folder as the Codex workspace and accept its trust prompt. Codex
intentionally ignores project-local `.codex/config.toml` until that exact workspace is trusted, so
its projected MCP servers and OKF filesystem permissions are inactive before this one-time step.

This guide builds from the `stub` backend (the offline fixture). Drop the flag to build against the
live database you deployed in step 2 — `surreal` is the default backend.

Re-running the build removes stale files from each emitter's prior inventory and preserves foreign
siblings. Try the `--purposes content` narrowing above and watch both library slices shrink.

The fixture also projects the ambient `update-workspace` skill. Invoke `/update-workspace` in
Claude or `$update-workspace` in Codex only when you want it to act. It verifies the active user,
preserves the build receipt's original purpose selection, refuses dirty context repos, and asks
before updating the global CLI and rebuilding. Start a new session after a successful refresh.

> **Expect okf warnings with the fixture.** The `acme` example's `okf-repo` buckets point at
> `acme-labs/*` repos that don't exist on GitHub. `build` still emits the workspace files, but prints
> `⚠ context/<bucket> not mounted (...)` for each unreachable repo — the projection degrades cleanly,
> it doesn't fail. A real tenant whose KB repos exist gets them cloned/symlinked under `context/`.

## 7. See enforcement live (optional)

The `clients` bucket in the fixture is `surreal`-backed and row-scoped — the apply in step 2
already **provisioned** its `client` table + PERMISSIONS from the graph (ADR 0011). Seed the
fixture's demo rows, then list them **as the logged-in user** — the database enforces record-level
PERMISSIONS:

```bash
bun run seed:acme                          # demo rows (fixtures/example/seed.ts)
bun bin/merovingian.ts data acme client
```

`ada` (owner of `content`, `acme`) versus `cleo` (scoped `delivery`, `north`) will see different
rows — the backend decides, not the build. See [`enforcement`](../concepts/enforcement.md).

## 8. The god-view console (optional)

```bash
bun bin/merovingian.ts console acme
```

Serves a read-only, no-auth view of the whole `acme` graph — read from the live db you deployed in
step 2 (`--backend stub` would serve the fixture instead) — at `http://127.0.0.1:8888`. `Ctrl-C` to
stop.

## Cleanup

```bash
bun run db:down
rm -rf /tmp/ada-acme ~/.merovingian/acme
```

## Next

- [`operating-a-tenant`](./operating-a-tenant.md) — the real operator lifecycle.
- [`authoring-the-graph`](./authoring-the-graph.md) — the edit → plan → apply change loop.
- [`concepts/overview`](../concepts/overview.md) — the mental model.
- [`reference/cli`](../reference/cli.md) — every command and flag.
