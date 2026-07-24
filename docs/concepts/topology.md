# Topology — the runtime pieces

Who runs where, and what each one holds and trusts. The design keeps secrets off the user's machine.
Two ways to get there: the **build/auth service** (root creds + the JWT signing key live only
server-side, identity via GitHub — the diagram below), or **password SIGNIN** (ADR 0015, no service:
each person holds only their own password; SurrealDB checks the argon2 hash in `credential` and
itself issues the scoped token, signed with a KEY that never leaves the database). Either way, no
machine ever holds a forge-anyone secret.

```
  ┌─────────────────────────── user's machine ───────────────────────────┐
  │                                                                       │
  │   CLI (merovingian)          Claude Code workspace                    │
  │   · login / build / graph      · CLAUDE.md, .mcp.json, settings.local │
  │   · holds a gh token           · stdio MCPs (child processes):        │
  │       (from `gh auth token`)       - surreal-data   } fetch a fresh   │
  │                                    - inbox          } token per call  │
  │                                                                       │
  │   console (127.0.0.1)  — read-only god-view UI (no auth, localhost)   │
  └───────────────────────────────┬───────────────────────────────────────┘
                                   │  gh token (Bearer)          scoped JWT
                                   ▼                                  │
  ┌──────────── build/auth service (server-side) ────────────┐        │
  │  · gh-auth: gh token → gh login → user record            │        │
  │  · HOLDS: Surreal root creds + JWT signing key           │        │
  │  · GET /whoami · GET /manifest · GET /token (mints JWT)   │        │
  └───────────────────────────────┬──────────────────────────┘        │
                                   │ root (server-side only)           │
                                   ▼                                   ▼
  ┌──────────────────────────── SurrealDB ────────────────────────────────┐
  │  structural tables (graph) · business tables (domain + inbox)         │
  │  DEFINE ACCESS identity (JWT) · record-level PERMISSIONS on $auth      │
  └───────────────────────────────────────────────────────────────────────┘
```

## The pieces

### CLI — `merovingian` (`src/cli.ts`, `bin/`)

Runs on the user's machine. `login`, `build`, `graph`, `deploy`, `reset`, etc. Holds a **GitHub
token** (reused from the local `gh` CLI — `src/transport.ts`), nothing more. In remote mode it never
sees root creds or the signing key: it asks the service for a `Manifest` and consumes it. Whether a
namespace is served locally (stub/surreal) or by a remote service is recorded per-machine
(`src/transport.ts`, `readNamespace`).

### The workspace (Claude Code project folder)

Emitted by `build`: `CLAUDE.md` (index), `.mcp.json` (MCP servers), `.claude/settings.local.json`
(external marketplaces/plugins, `additionalDirectories`, env — git-ignored),
`.claude/skills/` + `.claude/agents/` (the materialized library slice — wiped and rebuilt every
build, ADR 0012), `.merovingian/build.json` (stamp). It carries **no reusable credential** — only a
*token source* telling the MCPs how to fetch a fresh scoped JWT. Trusts nothing on its own; its
access is decided by the DB.

### The stdio MCPs (`src/mcp/`)

Child processes launched by Claude Code inside the workspace, speaking JSON-RPC over stdio (all logs
to stderr).

- **`surreal-data`** — scoped reads of business data, **manifest-driven** (ADR 0011): two generic
  tools, `tables` (list the identity's bucket mounts) and `select` (`{table, filter?, limit?}` —
  the table is validated against the mounts). The mounts arrive via the `MEROVINGIAN_BUCKETS` env
  var, stamped by `build` from the manifest's surreal mounts — affordance, never authority (the db
  enforces). Declared only when the person actually has data buckets.
- **`inbox`** — ambient (always present): append `journal` / `friction` entries (frictions carry
  a `scope` — whose problem it is), plus the local-governance surface (ADR 0014): `pending`
  lists the undrained frictions within the caller's real lineage reach (the db filters),
  `resolve` stamps drained + a `resolved_through` trace, `rescope` hands off within reach.
  `MEROVINGIAN_PURPOSES` (stamped by `build`) is the scope hint — affordance, never authority.

Both hold **no token**. Per call they fetch a fresh scoped JWT (`src/mcp/token-source.ts`) — from the
service via `gh` (remote) or dev-minted from `MEROVINGIAN_USER` (local) — then `connectWithToken` and
run the query as that `$auth` identity. They trust only what SurrealDB's `PERMISSIONS` return.

### The build/auth service (`src/server/service.ts`)

The **server-side box that holds the secrets**: Surreal **root credentials** and the **JWT signing
key**. It authenticates the human via GitHub (`gh token → login → user record`) and exposes three
gh-authenticated endpoints:

- `GET /whoami` — resolve the caller's identity in a namespace.
- `GET /manifest` — run `resolve` server-side, return `{ manifest, token }`.
- `GET /token` — mint a fresh scoped Surreal JWT (this is what the MCPs poll per call).

It reuses the **same** `resolve` / `SurrealProvider` as the in-process path; the only additions are
the network boundary and gh-auth. Connects to Surreal as **root** — server-side only.

### The console (`src/server/console.ts`)

A **local, read-only, no-auth** web UI of the whole tenant graph (the Architect's god-view). Binds
to **`127.0.0.1` only** — localhost-trust is its entire auth story for this prototype slice.
Deliberately a **separate server** from the build/auth service: different trust models must not
share a handler. It reads the provider **directly** (`getDefinition` + `listAssignments`), not
through the per-persona `BuildService`.

### SurrealDB (`surreal/`)

Holds both layers: **structural tables** (the graph — reconciled by `deploy apply`) and
**business tables** (the engine's `inbox` plus the tenant's domain tables, **generated** from the
graph's surreal buckets at apply time — ADR 0011). `DEFINE ACCESS identity` verifies service-signed JWTs and
binds `$auth`; record-level `PERMISSIONS` gate every sensitive row against that identity. This is the
real enforcement point — see [enforcement.md](./enforcement.md). Root access is trusted only from the
service (and dev tooling); record/JWT sessions are always subordinate to the permissions.

## Trust summary

| Piece            | Runs where          | Holds                              | Trusts                          |
|------------------|---------------------|------------------------------------|---------------------------------|
| CLI              | user machine        | gh token *or* own password (`.env`)| the service's `Manifest`/token, or the DB-issued SIGNIN token |
| workspace + MCPs | user machine        | a token *source* (no token)        | SurrealDB `PERMISSIONS`         |
| console          | user machine (`:local`) | nothing (no auth)              | localhost binding               |
| build/auth service | server-side       | **root creds + JWT signing key**   | GitHub identity                 |
| SurrealDB        | server / container  | the graph + business data **+ the signing KEY + credential hashes (SIGNIN)** | service-signed JWTs / its own SIGNIN |

Default backend is `surreal` (the live DB); `--backend stub` selects the offline `acme` fixture,
and a remote namespace config points at the service instead. See [architecture.md](./architecture.md) for the code seams
and [enforcement.md](./enforcement.md) for the JWT + PERMISSIONS mechanics.

> **Binding, and why it matters.** The console binds `127.0.0.1` explicitly (`src/server/console.ts`)
> — it is a no-auth god-view and must never leave the machine. The build/auth service does **not** set
> a hostname (`Bun.serve({ port })` in `src/server/service.ts`), so it listens on **all interfaces**
> and defaults to `PORT` `8787`. Since it holds the Surreal root creds and the JWT signing key, put it
> behind a reverse proxy / firewall in production rather than exposing `8787` directly.
