# Connections and security

Use this reference to select transport, locate configuration, and keep secrets on the correct side
of the trust boundary.

## Connection resolution

The tenant namespace names the Surreal database. Server location is resolved from an explicit
override, environment, the per-machine namespace registry, or the local development default.

A tenant repo may commit a `merovingian.toml` containing only the server URL:

```toml
[surreal]
url = "wss://db.example.com/rpc"
```

Authoring commands read it and register the URL for that namespace on the operator's machine.
Credentials never belong in this file. Keep root values in the operator/service environment or the
tenant repo's gitignored `.env`:

```dotenv
SURREAL_URL=wss://db.example.com/rpc
SURREAL_USER=<operator user>
SURREAL_PASS=<operator password>
SURREAL_NS=merovingian
```

`SURREAL_DB` normally defaults to the tenant namespace. Avoid overriding it unless the deployment
topology deliberately maps the tenant to another database.

## Authentication and transport choices

### Local development

Use `--backend stub` only for the synthetic offline fixture. A local Surreal container is suitable
for development and tests, not proof that the production connection or permissions work.

### Direct operator connection

System credentials may live on a trusted operator machine for authoring, deploy, password
administration, root drain, and local diagnostics. Do not copy this environment to member machines.

### Password SIGNIN

For a small real tenant without the build/auth service, the operator creates each person's password
with `merovingian passwd`. The member's workspace carries `MEROVINGIAN_USER` and
`MEROVINGIAN_PASS`; Surreal validates the hash and issues the scoped token. The database must remain
on a private network because member machines connect to it directly.

### Remote build/auth service

For service-backed operation, register the machine once and authenticate through GitHub:

```bash
gh auth login
merovingian namespace add <namespace> https://build.example.com
merovingian login <namespace>
```

The service holds root credentials and the JWT signing key, resolves the GitHub login to the tenant
user, and returns a scoped manifest/token. User machines should hold only their GitHub credential
and short-lived scoped tokens.

## Provisioning and signing key

A real first `deploy apply` requires a private `MEROVINGIAN_JWT_SECRET`; it refuses to provision a
tenant with the public development key. The same key must be held by the build/auth service when it
mints tokens. Under password-SIGNIN-only operation, discard the provisioning copy after the key is
bound inside the database.

Routine deploys do not rotate a live tenant's signing key because doing so would invalidate every
outstanding token. Treat key rotation as a separately reviewed production procedure with a restart
of every token-minting service; do not improvise it during normal tenant administration.

## Company tool secrets

Tool environment entries may reference company keys, but the secret value must be resolved where
the build service runs. Local builds can resolve them from a member's gitignored `.env`; remote
builds resolve them server-side. Generated secret-bearing harness files are mode-restricted and
must not be committed, copied into support messages, or built inside a Git repository.

`library/workspace.md` is delivered to every authenticated tenant member. It must never contain a
credential, private topology, customer-specific secret, or information unsuitable for that entire
audience.

## Production checklist

- SurrealDB is durable, backed up, and reachable only from intended operators, members using
  password SIGNIN, or the service.
- Root credentials and the signing key are stored outside Git and member workspaces.
- The remote service is behind TLS, a reverse proxy/firewall, and production monitoring; do not
  expose an unaudited development process directly.
- `merovingian console` remains localhost-only: it is a no-auth full-tenant view.
- GitHub identities and repository ACLs match the graph's external mounts.
- A restore procedure is tested independently of Merovingian; `reset` is not backup or recovery.
- The plugin, CLI, tenant library templates, and generated workspaces have distinct update cycles
  and are tracked deliberately.

If the task involves hosting, backups, signing-key rotation, firewalling, or incident response,
surface the infrastructure steps and required authority explicitly. The Merovingian CLI does not
make those external changes on the admin's behalf.
