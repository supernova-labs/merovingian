# Reference — environment variables

Every environment variable the engine reads, its default, and what it controls. Grouped by where
they take effect. Defaults are the ones baked into the source; where a default matches
`docker-compose.yml` it is called out.

Related: [machine-layout](machine-layout.md) · [connection-and-secrets](../guides/connection-and-secrets.md) ·
[going-to-production](../guides/going-to-production.md) · [cli](cli.md)

## Backend connection (`surrealConfig`)

Read by `surrealConfig()` in `src/provider/surreal.ts`. These describe how the engine (or the
service, or a system MCP) reaches SurrealDB.

| Var | Default | Controls |
| --- | --- | --- |
| `SURREAL_URL` | `ws://localhost:8020/rpc` | The SurrealDB RPC endpoint. Matches `docker-compose.yml` (host port `8020` → container `8000`). Resolution: per-invocation override › this env › the per-tenant registration (`merovingian.toml` → `~/.merovingian/<ns>/namespace.json`, see [connection-and-secrets](../guides/connection-and-secrets.md#per-tenant-server-merovingiantoml)) › the default. |
| `SURREAL_USER` | `root` | Sign-in user for a **root** connection (engine/service side). Matches compose (`--user root`). |
| `SURREAL_PASS` | `root` | Sign-in password for the root connection. Matches compose (`--pass root`). |
| `SURREAL_NS` | `merovingian` | The SurrealDB **namespace** — fixed for all tenants. |
| `SURREAL_DB` | *the tenant name* | The SurrealDB **database** = the merovingian tenant (e.g. `acme`). Defaults to the `tenant`/`namespace` argument passed to `surrealConfig(tenant)`. |

Note the two senses of "namespace": the merovingian *tenant* (the graph, the CLI's `<namespace>`
argument) maps onto the SurrealDB *database*, while the SurrealDB *namespace* is the fixed
`merovingian`. See [going-to-production](../guides/going-to-production.md).

## Backend selection

| Var | Default | Controls |
| --- | --- | --- |
| `MEROVINGIAN_BACKEND` | `surreal` | `defaultBackend()` in `src/service/build-service.ts`: set to `stub` to select the offline `acme` fixture; any other value (or unset) reads the live DB in-process. A `--backend` flag overrides it. |

## JWT signing

Read in `src/provider/surreal.ts` (`mintIdentityJwt`).

| Var | Default | Controls |
| --- | --- | --- |
| `MEROVINGIAN_JWT_SECRET` | `merovingian-dev-secret-change-me` (the `DEV_JWT_SECRET` constant, dev/test only) | HS256 secret used to sign the scoped identity JWT, and to bind the `KEY` of `surreal/auth.surql`'s `DEFINE ACCESS identity` at provision time. Signing and provisioning **must use the same value** or the DB rejects the token. A real `deploy apply` **requires** this (it refuses to provision a tenant with the public dev key); `reset` (dev/test) may fall back to the default. In production the service holds it; never commit it. |

## Graph authoring commands

Read in `src/graph/load-graph.ts` (`resolveGraphPath`).

| Var | Default | Controls |
| --- | --- | --- |
| `MEROVINGIAN_GRAPH` | `graph.yaml` (in cwd) | Which `graph.yaml` an authoring command (`reset`, `deploy plan/apply`, `library update`) acts on (the tenant `library/` is read from the same folder). Precedence: `--graph <path>` › `MEROVINGIAN_GRAPH` › `./graph.yaml`. Throws if none exists. |

## HTTP servers

| Var | Default | Controls |
| --- | --- | --- |
| `PORT` | `8787` | Port for the build/auth service (`startService` in `src/server/service.ts`). Overridable via a `--port`/`port` option. |
| `CONSOLE_PORT` | `8888` | Port for the read-only console UI (`startConsole` in `src/server/console.ts`, bound to `127.0.0.1`). Overridable via a `port` option. |

## System MCP env (written into `settings.local.json` / `.mcp.json` by `build`)

These are consumed by the bundled system MCPs (`surreal-data`, `inbox`) via `src/mcp/token-source.ts`
(`cfgFromEnv`, `envTokenSource`). `build` writes them into the workspace's MCP env; you normally do
not set them by hand. See [emit](../../src/projection/emit.ts) and
[connection-and-secrets](../guides/connection-and-secrets.md).

| Var | Default | Controls |
| --- | --- | --- |
| `MEROVINGIAN_DB` | *(required — throws if unset)* | The SurrealDB database the MCP connects to. Set by `build` to the tenant's db. |
| `SURREAL_URL` | `ws://localhost:8020/rpc` | RPC endpoint for the MCP connection. |
| `SURREAL_NS` | `merovingian` | SurrealDB namespace for the MCP connection. |
| `MEROVINGIAN_SERVICE_URL` | *(unset)* | **Remote/real path.** The build/auth service URL; the MCP fetches a fresh scoped token per call from `<url>/token` using the local `gh` token. When set, the MCP does NOT mint locally. |
| `MEROVINGIAN_NAMESPACE` | falls back to `MEROVINGIAN_DB` | The merovingian namespace passed to the service's `/token` call. |
| `MEROVINGIAN_USER` | *(unset)* | **Dev path.** When `MEROVINGIAN_SERVICE_URL` is unset, the MCP dev-mints a scoped JWT locally for this user id. One of `MEROVINGIAN_SERVICE_URL` or `MEROVINGIAN_USER` must be set, or the token source throws. |
| `MEROVINGIAN_BUCKETS` | `[]` (absent/broken JSON = no mounts) | The identity's bucket mounts (a JSON `SurrealMount[]`), read by the `surreal-data` MCP (`mountsFromEnv` in `src/mcp/surreal-data.ts`) as its tool surface (`tables` / `select`). Stamped by `build` from the manifest's surreal mounts — **not user-set**. Affordance only: enforcement stays with the db's PERMISSIONS (ADR 0011). |
| `MEROVINGIAN_PURPOSES` | `[]` | The projection's visible purposes (a JSON `string[]`), read by the `inbox` MCP (`purposesFromEnv` in `src/mcp/inbox.ts`) as the scope-hint for `friction`/`pending`. Stamped by `build`. Affordance only: read/resolve reach is the db's lineage permission (ADR 0014). |

`MEROVINGIAN_JWT_SECRET` (above) also applies here when the MCP dev-mints.

### Also emitted (not read back by the engine)

`build` writes a few env keys into `settings.local.json` that Claude Code / plugins consume, not the
engine itself: `MEROVINGIAN_NAMESPACE`, `MEROVINGIAN_USER`, `MEROVINGIAN_TOKEN` (a
`fake-<user>-token` placeholder), plus any resolved **company keys** (see below). Source:
`buildSettings` in `src/projection/emit.ts`.

## Company API keys (`${VAR}` refs)

Not a fixed variable list — each tenant's `graph.yaml` `tools:` registry names the vars it needs. A
tool with `keySource: company` and an `env` entry like `PERPLEXITY_API_KEY: "${PERPLEXITY_API_KEY}"`
resolves `${PERPLEXITY_API_KEY}` from the **environment where the build service runs** (server-side
in production) and lands the value in the workspace's `settings.local.json` env. Source:
`resolveToolEnv` in `src/projection/resolve.ts`, `load-graph.ts` (`ToolSchema`). If the referenced
var is unset, nothing is emitted for that key (fail-open on the value, silent). See
[connection-and-secrets](../guides/connection-and-secrets.md) and
[graph-yaml](graph-yaml.md).
