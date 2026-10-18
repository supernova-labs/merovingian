# Environment variables

## Operator and optional personal CLI

| Variable | Default | Use |
|---|---|---|
| SURREAL_URL | registry URL, then ws://localhost:8020/rpc | Direct endpoint; explicit invocation/tenant-config override wins |
| SURREAL_NS | merovingian | Surreal namespace |
| SURREAL_DB | tenant argument | Database override; verify before any mutation |
| SURREAL_USER / SURREAL_PASS | root / root | Administrative credentials; defaults for local development |
| MEROVINGIAN_JWT_SECRET | public dev key only in explicit dev/reset path | Private first-provisioning key; existing identity access is not rotated by routine deploy |
| MEROVINGIAN_NEW_PASS | stdin | Input for passwd; never place it in command arguments |
| MEROVINGIAN_PASS | unset | Individual password for login/graph and password-selected data reads |
| MEROVINGIAN_GRAPH | ./graph.yaml | Authoring graph, overridden by --graph |
| MEROVINGIAN_BACKEND | surreal | Set stub for the offline acme fixture; --backend wins |
| CONSOLE_PORT | 8888 | Local console; --port wins |
| MEROVINGIAN_NO_UPDATE_CHECK | unset | Any value disables passive package-version notice |
| CI | unset | Also disables passive package-version notice |

History export requires explicit SURREAL_USER/SURREAL_PASS rather than accepting their local
defaults. Passive update notices are fail-silent and cached for 24 hours; they are not the
setup's deterministic catalog/plugin diagnosis.

## Catalog and Journal MCPs

All five settings are required with no defaults or operator-registry fallback:
SURREAL_URL, SURREAL_NS, MEROVINGIAN_DB, MEROVINGIAN_USER, MEROVINGIAN_PASS.
Configure them in private native MCP definitions. MEROVINGIAN_DB is independent of
SURREAL_DB. These MCPs never use SURREAL_USER/PASS or MEROVINGIAN_JWT_SECRET.
See [Catalog and Journal](catalog-and-journal.md).

## Generic data diagnostic MCP

`surreal-data` requires MEROVINGIAN_DB and MEROVINGIAN_USER. SURREAL_URL defaults to
ws://localhost:8020/rpc and SURREAL_NS to merovingian. MEROVINGIAN_BUCKETS is a JSON array
of `{bucket, tables, scope?}`; absent/invalid JSON gives no mounts. Mounts describe the tool
surface, not authority; the database enforces the query.

MEROVINGIAN_PASS chooses individual SIGNIN. Without it the operator/test path mints a token
using MEROVINGIAN_JWT_SECRET or the development key; production databases must not trust the
public development key. This differs from the strict personal MCPs. A configured
MEROVINGIAN_SERVICE_URL is rejected because remote service authentication was removed.

The engine no longer emits MEROVINGIAN_TOKEN, company keys, purpose hints or client configs.
Third-party tool credentials use native integrations. Do not put secrets in general instructions,
marketplaces, graph YAML or shared support logs.
