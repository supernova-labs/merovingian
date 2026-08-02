# Merovingian

**Merovingian OS — the Source.** A declarative engine for human–AI partnerships: model an
organization as a **graph of purposes**, and Merovingian projects each person a **scoped Claude
Code and Codex workspace** and reconciles the graph like infrastructure.

Two operations, one graph:

- **`build`** — *projection*. Given a person, project the workspace they're entitled to: the
  purposes they can see, the knowledge buckets they can read/own, the skills/tools/agent that load
  (their slice of the tenant **library**, materialized into each harness's native layout), and the
  row-level scope on sensitive data. `build = projection of the global definition onto a scoped target
  (Purpose × Scope × Human)`.
- **`deploy`** — *reconciliation*. The desired state is a `graph.yaml` **plus a `library/`** of
  first-party skill/agent prompts and tenant-wide `workspace.md` instructions, all in the tenant
  repo (ADRs 0012/0018); `deploy plan` diffs them against the live SurrealDB (content as short
  hashes), `deploy apply` converges — structure-only, idempotent, referrer-safe on delete.

Enforcement is the **backend's** job, not the build's: sensitive data carries record-level
SurrealDB PERMISSIONS keyed on a scoped JWT identity. *Generation ≠ enforcement* — the build
generates the scope; the database honors it.

The third primitive — **decisions** — has storage too (ADR 0013): purposes own decision domains
(`decides:`), members log in-flight calls via an ambient MCP, and governance promotes what
converges into ratified records in the tenant repo's `decisions/`, shipped by deploy.

## Install

Merovingian runs on [Bun](https://bun.sh) (>= 1.3):

```bash
bun add -g @supernova-labs/merovingian   # installs the `merovingian` command
# or, zero-install per call:
bunx @supernova-labs/merovingian <command>
```

## Quickstart

You need a reachable SurrealDB (v3) — every command except `init` talks to it:

```bash
docker run --rm -d -p 8020:8000 surrealdb/surrealdb:v3 start --user root --pass root
```

Your tenant signs scoped identity tokens with a private key. Generate one, and keep it in your
environment — the same key provisions the database and mints tokens (and later lives only on the
build/auth service). Persist it so every session shares it:

```bash
export MEROVINGIAN_JWT_SECRET=$(openssl rand -hex 32)   # then add this line to ~/.zshrc (or ~/.bashrc)
```

Then the whole happy path — scaffold, converge, log in, project:

```bash
merovingian init acme --owner ada --github ada-gh   # scaffold the tenant repo (./acme)
cd acme
# review library/workspace.md — it reaches every member and must never contain secrets
merovingian deploy apply        # converge — bootstraps the virgin db (plan = read-only audit)
merovingian login acme ada

mkdir ../ada-workspace && cd ../ada-workspace
merovingian build acme          # project ada's scoped workspace into this folder
```

> **Just want to look first?** `bunx @supernova-labs/merovingian build acme --backend stub` projects
> the bundled example tenant into the current folder — no database, no secret, no config. The steps
> above are for standing up your own tenant on a real SurrealDB.

`MEROVINGIAN_JWT_SECRET` has no default: `deploy apply` refuses to key a real tenant to a guessable
value (see [going-to-production](docs/guides/going-to-production.md) for the service that holds it in
a team setup).

Open the workspace in Claude Code or Codex and the projection is live. One build emits each
harness's native root instructions, skills, subagents, MCPs and permission config from the same
scoped manifest. Tenant admins maintain shared context and operating defaults in
`library/workspace.md`; after `deploy apply`, every member's next build includes the same section
in `CLAUDE.md` and `AGENTS.md`. A tenant on its own database declares it once in
`merovingian.toml` — every command finds the right server from anywhere.

**Contributing / running from a checkout:** `bun install`, then `bun bin/merovingian.ts <command>`
(the test tenant lives in `fixtures/example/`; `bun run db:up` starts the dev SurrealDB).

## Commands

**Authoring** (read the graph from `--graph <path>` / `./graph.yaml` in a tenant repo; namespace
comes from the yaml):

- `init <tenant> --owner <id> --github <login>` — scaffold a new tenant repo.
- `deploy plan [--graph P]` — audit: diff graph × Surreal (read-only). Exit `1`=drift, `2`=invalid.
- `deploy apply [--graph P] [--yes]` — converge Surreal to the graph (`--yes` allows deletions);
  bootstraps a virgin db (first run included); also provisions the tenant's domain tables +
  PERMISSIONS from its surreal buckets (ADR 0011).
- `reset [--graph P]` — **dev/test only**: wipe the structural tables + reproject. Never on a
  live tenant.

**Runtime** (take a `namespace` — selects the db / offline stub):

- `login <ns> [user]` · `graph <ns>` · `build <ns> [--purposes a,b]` ·
  `data <ns> <table>` (rows the logged-in user can see — enforced by Surreal) ·
  `inbox <ns> [--all] [--drain]` (governance drain of the learning inbox, root-only) ·
  `decisions <ns> [--all] [--drain]` (governance drain of the in-flight decision log, root-only) ·
  `console <ns>` (read-only god-view UI) · `service` (HTTP build/auth, gh-auth).

Default backend is `surreal` (the live db); `--backend stub` runs the offline `acme` fixture.

## Governance (repo tooling, not a graph purpose — ADR 0010)

Governance runs as a **Claude Code plugin** installed in the tenant repo (this repo carries the
marketplace at `.claude-plugin/` + `plugin/`). `init` wires a tenant's `.claude/settings.json` to
enable it. It ships the `architect` agent plus the `merovingian` start-here, `tenant-admin`
operations, and `drain` governance skills; they invoke this CLI. Governance auth = git ACL of the
tenant repo + Surreal credentials — not a graph edge (the graph is domain-only).

## Testing

```bash
bun test          # golden suite: SAME assertions for stub AND surreal (surreal skips if DB down)
bun run typecheck
```

Golden green on **both backends** proves the stub isn't throwaway and the projection survives the
`Stub → Surreal` provider swap. The tested boundary is the `Manifest`; swapping `Stub→Surreal` or
`Local→Remote` never moves it.

## Architecture

```
graph/       load-graph (yaml + library → Definition) · plan (validate + diff) · apply (converge) · records
provider/    DefinitionProvider (async) — StubProvider (fixture) | SurrealProvider (caminho B)
projection/  resolve (graph + assignment → Manifest, pure) · emit (Manifest → workspace files)
service/     BuildService boundary: getManifest(identity) → scoped Manifest (Local | Remote/HTTP)
commands/    init · reset · deploy · library · login · graph · build · data · inbox · decisions
server/      console (god-view) · service (gh-auth, holds root + signing key)
mcp/         surreal-data · inbox · decisions — stdio MCPs; enforcement reaches the tool (fresh token per call)
surreal/     schema.surql (structure) · data.surql (engine-only: JWT access + inbox + decision tables)
fixtures/    example — a generic synthetic `acme` tenant (tests + offline stub)
```

## Documentation

Full docs are in [`docs/`](./docs/README.md) — concepts (how it works), guides (the operator
runbook, authoring, production), and reference (CLI, `graph.yaml` schema, env vars, machine layout).
Design rationale lives as ADRs in `docs/decisions/`; the conceptual base (the 5 primitives, the 5
principles) in `docs/foundation/`.

## License

MIT.
