# Guide — connection and secrets

How to point the CLI at a SurrealDB, set the JWT signing secret, and get company API keys into a
workspace. Terse, concrete.

Related: [env-vars](../reference/env-vars.md) · [machine-layout](../reference/machine-layout.md) ·
[going-to-production](going-to-production.md) · [authoring-the-graph](authoring-the-graph.md)

## 1. Point the CLI at a SurrealDB

The tenant's `namespace:` picks the **database**; where the **server** lives is per-tenant config.
Url resolution (`surrealConfig` in `src/provider/surreal.ts`): per-invocation override ›
`SURREAL_URL` env › the machine registry (below) › the docker default. The remaining knobs come
from env, with defaults matching `docker-compose.yml`:

```
SURREAL_URL=ws://localhost:8020/rpc
SURREAL_USER=root
SURREAL_PASS=root
SURREAL_NS=merovingian
SURREAL_DB=<tenant>          # defaults to the namespace you pass on the CLI
```

### Per-tenant server: `merovingian.toml`

A tenant repo carries a committed `merovingian.toml` (seeded by `init`, commented out = default):

```toml
[surreal]
url = "ws://localhost:9019/rpc"
```

Authoring commands (`deploy plan/apply`, `reset`) read it from the repo root, use that url, and
**register it on your machine** (`~/.merovingian/<ns>/namespace.json`,
`{ transport: "surreal", url }`) — so namespace-keyed commands (`build`, `login`, `inbox`,
`decisions`, `data`) reach the same server from anywhere, no env juggling. Two tenants on two
servers just work side by side.

**Credentials never go in the toml** (it's committed): `SURREAL_USER`/`SURREAL_PASS` come from env —
or a gitignored `.env` in the tenant repo (Bun auto-loads it for commands run there). Source:
`src/tenant-config.ts`.

### Local SurrealDB (docker)

```bash
bun run db:up      # docker compose up -d → SurrealDB v3 on :8020, root/root
bun run db:down    # stop
```

With the container up, nothing else is needed — the defaults already point at it, and `surreal` is
the default backend. To run against the offline `acme` fixture instead (no database), opt in
per-command with `--backend stub`, or globally:

```bash
export MEROVINGIAN_BACKEND=stub
```

### A separate / remote SurrealDB

Override the URL and credentials:

```bash
export SURREAL_URL=wss://surreal.example.com/rpc
export SURREAL_USER=root
export SURREAL_PASS=<root-password>
# SURREAL_NS stays merovingian; SURREAL_DB defaults to the tenant
```

`SURREAL_USER`/`SURREAL_PASS` are **root** credentials — used by the engine and the service, never
handed to an end user's workspace. A workspace only ever gets a scoped JWT (see below).

## 2. The JWT signing secret

Sensitive data is protected by SurrealDB record-level PERMISSIONS keyed on a scoped identity JWT. The
engine mints that JWT (`mintIdentityJwt`) signed with HS256:

```bash
export MEROVINGIAN_JWT_SECRET=<the-signing-secret>
```

- Default is the `DEV_JWT_SECRET` constant `merovingian-dev-secret-change-me` — dev only, and
  world-readable on purpose (a token signed with it is only ever accepted by a dev/test DB).
- It **must match** the `KEY` in `surreal/auth.surql`'s `DEFINE ACCESS identity`, or the DB rejects
  the token. `auth.surql` binds that `KEY` from this env at provision time (`deploy apply`/`reset`);
  a real `deploy apply` with no `MEROVINGIAN_JWT_SECRET` set **refuses to run** rather than key the
  tenant to the public dev secret.
- In production only the build/auth **service** holds this; user machines never see it (they hold a
  `gh` token and receive short-lived scoped tokens). See
  [going-to-production](going-to-production.md).

The JWT's `id` claim is `user:<userId>`, so SurrealDB sets `$auth` to that record and the PERMISSIONS
enforce row-level scope. **Generation ≠ enforcement**: the build generates the scope; the database
honors it.

## 3. Company API keys → workspace (`${VAR}` / keySource)

A tool in the graph's `tools:` registry declares how its key is sourced. Two values of `keySource`:

- `none` — keyless tool; its `env` is emitted as-is into `.mcp.json`.
- `company` — a shared company key; the `env` values are `${VAR}` references resolved **server-side**
  and injected into the workspace's `settings.local.json` env (kept out of `.mcp.json`, which is
  committed-by-convention, so no raw secret is committed).

Example (`fixtures/example/graph.yaml`):

```yaml
tools:
  search:
    command: uvx
    args: [search-mcp]
    env: { SEARCH_API_KEY: "${SEARCH_API_KEY}" }
    keySource: company
  docs:
    command: uvx
    args: [docs-mcp]
    env: {}
    keySource: none
```

### How the `${VAR}` resolves

At build time, `resolveToolEnv` (`src/projection/resolve.ts`) walks every `company` tool's `env`,
strips `${...}` to the bare var name, and reads it from **the environment where the build service
runs**:

```bash
# whoever runs the build (the service in prod; you locally) must have the key in env:
export SEARCH_API_KEY=sk-...
merovingian build acme
```

The resolved value lands in `<workspace>/.claude/settings.local.json` under `env`, which Claude Code
injects into every MCP. If the referenced var is unset, nothing is emitted for that key (silent — no
error). Source: `resolveToolEnv`, `buildSettings`/`buildMcp` in `src/projection/emit.ts`.

### Where each piece lands

| Artifact | Company key? | Keyless tool env? |
| --- | --- | --- |
| `.mcp.json` | empty `env` (`{}`) — no secret committed | full `env` inline |
| `.claude/settings.local.json` `env` | resolved value injected (gitignored) | — |

## 4. System-MCP token source (no key in a file)

The bundled `surreal-data` and `inbox` MCPs hold **no** JWT — they fetch a fresh scoped token per
call (`src/mcp/token-source.ts`). `build` writes their env for you:

- **Remote/real**: `MEROVINGIAN_SERVICE_URL` set → the MCP calls `<service>/token` with the local
  `gh` token per call; no token ever rests in a file, and expiry stops mattering.
- **Password signin (ADR 0015)**: `MEROVINGIAN_USER` + `MEROVINGIAN_PASS` set → the MCP signs in
  with the person's own password; SurrealDB checks the argon2 hash (`credential` table) and itself
  issues the scoped token. **No signing key on the machine** — each machine holds only its person's
  password (set by the operator with `merovingian passwd <ns> <user>`).
- **Dev/local-surreal**: only `MEROVINGIAN_USER` set → the MCP dev-mints the scoped JWT locally using
  `MEROVINGIAN_JWT_SECRET` (a real tenant rejects what this signs — dev/test dbs only).

You normally don't set these by hand; `build` derives them from the session and transport. See
[env-vars](../reference/env-vars.md#system-mcp-env-written-into-settingslocaljson--mcpjson-by-build).
