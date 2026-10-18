# Merovingian

**Merovingian OS — the Source.** A declarative engine that connects people and
agent capabilities through a graph of purposes.

The graph defines access to plugins, tools and repositories. Deploy reconciles
identity and graph state with SurrealDB and can reconcile GitHub repository access
and review protections. Authenticated Catalog and Journal MCPs provide discovery
and immutable personal history. A tenant-owned setup skill installs capabilities
through each client's native plugin system with human approval.

**Version 1.0.0 is published.** Workspace build, emitters and the old
inbox/decision runtime have been removed. See the
[history and cutover guide](docs/guides/history-and-cutover.md) before upgrading.
Install the published CLI with `bun add -g @supernova-labs/merovingian@1.0.0`
and confirm `merovingian --version` before operating a tenant.

## Develop locally

Requires Bun 1.3+ and SurrealDB 3 for database integration tests.

```sh
bun install
bun bin/merovingian.ts --help
bun test
bun run typecheck
```

`bun run db:up` starts the optional local database. Database-backed tests skip when
it is unavailable. The bundled `fixtures/example/` tenant is synthetic; real tenant
repositories and credentials belong outside the Source repository.

## Start a tenant

```sh
bun bin/merovingian.ts init acme --owner ada --github ada-example
```

Review the generated graph and connection configuration. Administrative deploy uses
`SURREAL_USER` and `SURREAL_PASS`; first-time identity provisioning also requires a
private `MEROVINGIAN_JWT_SECRET`. Keep credentials outside tracked files.
Run `deploy plan` and then `deploy apply` from the tenant directory using this
checkout's CLI. Set individual passwords with `passwd`.

Member machines use individual SurrealDB credentials, never administrative credentials
or signing keys. See [Catalog and Journal](docs/reference/catalog-and-journal.md)
for MCP configuration. General instructions live in `ambient.instructions`; plugin
content stays in marketplaces. Initial release support targets macOS with Claude
Code and Codex, both terminal and desktop.

## Administrative plugin

For Claude Code, install the repository marketplace plugin:

```text
/plugin install governance --marketplace supernova-labs/merovingian
```

The remote install uses the published repository revision. To review local plugin
changes, validate/load the checkout’s `plugin/` directory instead. The administrative plugin
is separate from tenant capability plugins and does not grant database access.

## Documentation

- [Documentation index](docs/README.md)
- [Catalog and Journal contract](docs/reference/catalog-and-journal.md)
- [History preservation and cutover](docs/guides/history-and-cutover.md)
- [Architecture decisions](docs/decisions/INDEX.md)

Historical ADRs remain as architectural evidence. ADR 0019 supersedes the former
build/library distribution and inbox/decision workflow for this major.
