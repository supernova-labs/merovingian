# Getting started from the checkout

These examples target Merovingian 1.0.1. Once that release is published, install it with
`bun add -g @supernova-labs/merovingian@1.0.1` and check `merovingian --version`.
The examples below use the Source checkout for offline development.
Install Bun 1.3+ and dependencies in the Source checkout:

```sh
bun install
bun bin/merovingian.ts --help
bun bin/merovingian.ts login acme ada --backend stub
bun bin/merovingian.ts graph acme --backend stub
```

The stub is an offline synthetic graph. Login writes local session metadata; graph is read-only. They do not prove database authentication or remote repository access.

## A synthetic database

Start the local SurrealDB with `bun run db:up`, then load the bundled example using
`bun bin/merovingian.ts reset --graph fixtures/example/graph.yaml`. Reset is exclusively
for disposable development/test databases. Use `deploy apply` to bootstrap real tenants.
Set an example user's password with `bun bin/merovingian.ts passwd acme ada`, supplying
the value through private stdin. With `MEROVINGIAN_PASS` set privately, login and graph
without `--backend stub` exercise individual authentication.

The fixture's marketplace and repository names are illustrative and are not installable
products. Native installation tests require a dedicated synthetic plugin and repository.
Configure personal Catalog/Journal using the [MCP reference](../reference/catalog-and-journal.md).

For a new tenant, run `init <tenant> --owner <id> --github <login>` from the chosen parent
folder using the absolute checkout CLI path. Review graph.yaml and connection details,
then follow [operating a tenant](operating-a-tenant.md). Init creates no database,
password, plugin installation or generated workspace.
