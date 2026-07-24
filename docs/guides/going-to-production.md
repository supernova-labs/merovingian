# Guide — going to production

From the offline stub to a real Surreal backend, then to the gh-authenticated build/auth service and
a multi-tenant deployment. Terse and concrete.

Related: [connection-and-secrets](connection-and-secrets.md) · [env-vars](../reference/env-vars.md) ·
[machine-layout](../reference/machine-layout.md) · [operating-a-tenant](operating-a-tenant.md) ·
[architecture](../concepts/architecture.md) · [topology](../concepts/topology.md)

## The three backends

One `BuildService` interface, three implementations (`src/service/build-service.ts`):

| Backend | What it is | Secrets on the user's machine |
| --- | --- | --- |
| `LocalBuildService(stub)` | The `acme` fixture in memory. Offline, golden tests. | none |
| `LocalBuildService(surreal)` | Reads the graph from Surreal **in-process** (holds root creds + signing key locally). | root creds + signing key |
| `RemoteBuildService` | Calls the HTTP service; identity via GitHub; secrets stay server-side. | only a `gh` token |

The tested boundary is the `Manifest` — swapping stub→surreal or local→remote never moves it.

## Step 1 — stub (offline)

Opt-in (`--backend stub` / `MEROVINGIAN_BACKEND=stub`). No DB. Good for tests, demos, and
contributors without a database.

```bash
merovingian build acme --backend stub   # offline acme fixture
```

## Step 2 — a real Surreal backend (in-process)

Stand up SurrealDB, deploy the graph, then build against it.

```bash
bun run db:up                                   # local docker SurrealDB (:8020, root/root)
# or point at a remote DB:
#   export SURREAL_URL=wss://surreal.example.com/rpc SURREAL_PASS=<root-pass>

merovingian deploy apply --graph graph.yaml     # converge the DB to the graph (bootstraps a virgin db)
merovingian deploy plan --graph graph.yaml      # audit: expect zero drift
merovingian build acme                          # build against the live DB (the default backend)
```

In-process surreal means **this machine** holds the root creds (`SURREAL_USER`/`SURREAL_PASS`) and
the signing key (`MEROVINGIAN_JWT_SECRET`). Fine for an operator; not what you hand to every user.
See [connection-and-secrets](connection-and-secrets.md).

## Step 3 — more people, no service yet: password SIGNIN (ADR 0015)

Before standing up the service, the small-team path: each person authenticates with **their own
password**. The operator sets it (`merovingian passwd <ns> <user>` — argon2 hash in the runtime
`credential` table); the person keeps `MEROVINGIAN_USER`/`MEROVINGIAN_PASS` in their workspace's
gitignored `.env`. SurrealDB checks the hash and **itself issues** the scoped token, signed with
the `KEY` that never leaves the database — no machine holds the signing key, and a compromised
laptop exposes exactly one identity (rotate it with `passwd`).

```bash
# operator, once per person (after deploy apply put them in the graph):
openssl rand -base64 18 | merovingian passwd acme ada
# the person, in their workspace .env:
#   MEROVINGIAN_USER=ada
#   MEROVINGIAN_PASS=<the password you handed them>
merovingian login acme ada        # password SIGNIN — no system creds on their machine
merovingian data acme clients     # scoped reads; the MCPs authenticate the same way
```

The condition attached (see the ADR): every machine dials the database directly, so the durable
SurrealDB must live on a **private network** (VPN/firewall) — never a public port. Known limit:
`build` on a member's machine still reads structure with system creds — serve `/manifest` from the
service inside the private network for that (issue #19); everything else (login, data, MCP tokens)
is covered by the password.

## Step 4 — the build/auth service (secrets server-side)

The service (`src/server/service.ts`, `bin/merovingian-service.ts`) is the server-side box that:

- holds the SurrealDB **root creds** and the **JWT signing key** (env, never committed);
- authenticates the human via their **GitHub** token (no OAuth app — reuses the user's `gh` token);
- runs the same `resolve`/`SurrealProvider` as the in-process path;
- returns a scoped `{ manifest, token }` — so the user's machine ends up holding **neither** root
  creds nor the signing key, just a `gh` token and a short-lived scoped token.

Run it:

```bash
export SURREAL_URL=wss://surreal.example.com/rpc
export SURREAL_PASS=<root-password>
export MEROVINGIAN_JWT_SECRET=$(openssl rand -hex 32)  # private; must match the tenant's auth.surql DEFINE ACCESS
export PORT=8787                                        # default
bun bin/merovingian-service.ts                          # (or: bun run service)
```

The **same** `MEROVINGIAN_JWT_SECRET` must be set when you provision the tenant (`deploy apply`) — it
binds the `KEY` in `surreal/auth.surql`'s `DEFINE ACCESS identity`. A real `deploy apply` with no
secret set refuses to run (it won't key a tenant to the public dev secret). Generate it once, keep it
private, share it only between the provisioning step and the service.

**Rotating the key of a LIVE tenant is deliberately explicit** — a routine `deploy apply` never
re-keys (it provisions the access only on a virgin db, so a drifted env can't silently invalidate
every outstanding token). To rotate: apply `surreal/auth.surql` directly with the new value
(root/db-owner: `db.query(<auth.surql>, { jwt_secret: <new> })`), then restart whatever mints with
the same value. Under password-SIGNIN-only operation the key never needs to be held anywhere after
provisioning — rotation just means re-keying the access with a fresh random value and discarding it.

Endpoints, all `Authorization: Bearer <gh-token>`:

| Route | Returns |
| --- | --- |
| `GET /whoami?namespace=<ns>` | `{ login, user, name, namespace }` — resolves the gh login → the tenant user. |
| `GET /manifest?namespace=<ns>[&purposes=a,b]` | `{ manifest, token }` — the scoped manifest + a fresh scoped Surreal JWT. |
| `GET /token?namespace=<ns>` | `{ token }` — a fresh scoped JWT (the system MCPs fetch this per call). |

The gh→user mapping is `SELECT ... FROM user WHERE github = $login`; a gh login not mapped in the
tenant gets `403`. Namespace defaults to `acme` if the query param is missing.

### Point a machine at the service

On each user's machine:

```bash
gh auth login                                    # the identity + KB permission boundary
merovingian namespace add acme https://build.example.com
merovingian login acme                           # no user arg — identity comes from /whoami
merovingian build acme                           # goes over HTTP; okf clones use local gh creds
```

`namespace add` writes `~/.merovingian/acme/namespace.json` (`{ transport: "remote", url }`); its
presence routes `login`/`build`/`graph` over HTTP (`src/transport.ts`,
[machine-layout](../reference/machine-layout.md)). The workspace's system MCPs get
`MEROVINGIAN_SERVICE_URL` and fetch `/token` per call with the user's `gh` token — no token rests in
a file.

The service's entire configuration surface is environment: `PORT` (default `8787`), the `SURREAL_*`
connection vars (it connects as **root**, server-side only), and `MEROVINGIAN_JWT_SECRET` (the signing
key). `bin/merovingian-service.ts` takes no flags. It sets no bind hostname, so it listens on all
interfaces — front it with a reverse proxy / firewall (see [topology](../concepts/topology.md)).

## Step 5 — the NS / DB model (multi-tenant)

SurrealDB namespace is **fixed** at `merovingian`; each tenant is a separate SurrealDB **database**
named after the tenant:

```
SurrealDB namespace = merovingian          (SURREAL_NS, fixed)
SurrealDB database   = <tenant>            (SURREAL_DB, defaults to the CLI namespace arg)
```

So `acme` and `nord` are two databases (`merovingian.acme`, `merovingian.nord`) under one namespace,
one root, one signing key. `surrealConfig(tenant)` (`src/provider/surreal.ts`) sets `db` to the
tenant unless `SURREAL_DB` overrides it (tests use a throwaway db via `--surrealDb`).

Multi-tenant service: one service process serves every tenant. The caller selects the tenant per
request with `?namespace=<tenant>`; the service opens the matching db, resolves the gh login within
it, and returns a scoped manifest + token. Root creds and the signing key are shared across tenants;
isolation is per-database plus the record-level PERMISSIONS keyed on the scoped JWT.

## Recap: secret placement

| Secret | stub | surreal (in-process) | password SIGNIN (ADR 0015) | service (remote) |
| --- | --- | --- | --- | --- |
| Surreal root creds | — | operator machine | operator machine only | service only |
| JWT signing key | — | operator machine | **inside the DB only** (discard after provisioning) | service only |
| Company API keys (`${VAR}`) | — | build env | workspace `.env` | service env |
| User machine holds | — | root + key | **their own password** (workspace `.env`) | `gh` token + short-lived scoped token |

See [connection-and-secrets](connection-and-secrets.md) for exactly how each of these is set and
where it lands.
