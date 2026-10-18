# Connections and security

## Select the correct connection

The tenant namespace in `graph.yaml` maps to a Surreal database. A tenant's optional
`merovingian.toml` declares `[surreal] url = "wss://db.example.test/rpc"` without credentials.
Authoring commands register that direct connection on the operator machine.
`SURREAL_DB` can override the database; verify it before any write.

Administrative commands use `SURREAL_USER` and `SURREAL_PASS`. First provisioning also
requires a private `MEROVINGIAN_JWT_SECRET`; ordinary deploys do not rotate an existing
access definition. Root credentials and signing keys never belong on member machines.
The local root/root defaults are for development only.

Catalog and Journal require all five personal settings explicitly: `SURREAL_URL`,
`SURREAL_NS`, `MEROVINGIAN_DB`, `MEROVINGIAN_USER`, `MEROVINGIAN_PASS`. Their password
SIGNIN path has no root, GitHub or development-token fallback. Store these in private
native client configuration. A project `.env` is optional, not the architecture.
Do not embed the tenant endpoint or password in a shared setup skill.

GitHub deployment uses the operator's `gh` authentication. This credential manages
repository ACLs; it is not the member's Merovingian login. External tool authentication
belongs to native integrations; the catalog does not distribute company secrets.

## Preserve and cut over

Export with `history export --graph <path> --output <new-private-directory>` and verify
with `history verify --archive <directory>`. The export requires explicit administrative
credentials. Keep it outside Git or in an explicitly ignored directory. Rehearse restore
in an isolated administrative database and compare records, IDs, links and timestamps.
The archive is historical data, not a complete backup of the tenant or its credentials.

Stop old writers and capture a final snapshot before switching production. New deploys
restrict existing inbox/decision tables to administrative access without deleting them.
Never run the old deploy against a cut-over tenant: it can restore old table permissions.
Historical friction triage may happen after release; preservation must precede cutover.

Production requires durable database storage, tested backups and intended network access.
The local console has no authentication and must remain on trusted localhost. A release
candidate needs the four macOS client paths and reviewed documentation. Neither publishing
nor changing production follows automatically from a successful synthetic test.
