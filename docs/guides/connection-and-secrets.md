# Connections and secrets

## Administrative CLI

`graph.yaml` supplies the tenant name. Optional `merovingian.toml` supplies a direct endpoint:

```toml
[surreal]
url = "wss://db.example.test/rpc"
```

Do not store credentials there. Authoring commands use this explicit URL before the environment,
then register it in `~/.merovingian/<tenant>/namespace.json`. Other namespace-keyed CLI reads
resolve an explicit override, `SURREAL_URL`, the registry, then localhost. `SURREAL_DB` overrides
the graph's database name; inspect it before applying to a real tenant.

Admin credentials are `SURREAL_USER` and `SURREAL_PASS`; root/root defaults serve local development.
First provisioning requires a private `MEROVINGIAN_JWT_SECRET`. Subsequent deploys leave an
existing identity access key intact. The key and root credentials stay in protected operator
storage; changing an environment variable does not rotate the database's live key.

Version 1.0.1 adds a provisioning guard: real keys must contain at least 32
characters after ignoring leading/trailing whitespace. Generate one with `openssl rand -hex 32`;
length is only a guard against accidental weak values, not proof of randomness. The guard applies
to new identity access, not existing tenants or the explicit development/reset path. With
password SIGNIN, the provisioning copy can be removed from the operator environment after use:
the database keeps its own signing key. This does not replace a tested recovery procedure.

The 1.0.1 `login` and `passwd` failure diagnostics identify the endpoint origin, namespace,
database, and configuration sources. They omit URL paths, credentials, query strings, fragments
and raw driver errors. Operator diagnostics describe the root → namespace → database signin
order and warn about development credential defaults. “Environment” includes values loaded
by the runtime from `.env`; it does not identify which file supplied them. Check the target
and credential sources before changing passwords or trying another deployment.

## Individual runtime

Catalog and Journal require `SURREAL_URL`, `SURREAL_NS`, `MEROVINGIAN_DB`, `MEROVINGIAN_USER`
and `MEROVINGIAN_PASS` explicitly. They do not read the operator registry or fall back to root,
GitHub or token minting. Configure these privately in the client's native MCP definition.
URLs must not embed credentials, query parameters or fragments. No workspace `.env` is required.

`login`/`graph` use the CLI connection resolution and individual password. The session file
contains metadata, not a token/password. Generic `data`/`surreal-data` still has an operator/test
mint path when a password is absent; do not use it to claim password isolation. Its former
`MEROVINGIAN_SERVICE_URL` path now fails explicitly.

Third-party tools authenticate through their native integrations. The catalog omits tool
commands, args, endpoints and environment values. General tenant instructions must not carry
secrets or audience-restricted information. A historical archive can contain sensitive text;
keep it in restricted administrative storage and test restore in isolation.

See [environment variables](../reference/env-vars.md) for exact defaults and
[production](going-to-production.md) for rollout boundaries.
