# Reference — machine layout

The per-machine on-disk layout the CLI uses. Everything is **per-machine = per-human**: one human's
session and cloned repos on their own laptop. Paths come from `src/paths.ts`.

Related: [env-vars](env-vars.md) · [connection-and-secrets](../guides/connection-and-secrets.md) ·
[operating-a-tenant](../guides/operating-a-tenant.md) · [cli](cli.md)

## Two roots

Config lives in a hidden dot-dir; the repo store is visible (you `cd`/branch/worktree into it).

| Path | What it holds |
| --- | --- |
| `~/.merovingian/<ns>/` | Config: the session and the (optional) remote-transport pointer. Hidden. |
| `~/merovingian/<ns>/` | The central repo store: cloned knowledge-base (okf) repos. Visible. |

`<ns>` is the merovingian namespace (the tenant name, e.g. `acme`).

## Files

| Path | Written by | Contents |
| --- | --- | --- |
| `~/.merovingian/<ns>/currentuser.json` | `merovingian login` (`sessionFile`) | The session: `{ namespace, user, github?, loggedInAt }`. Who is logged into this tenant on this machine. |
| `~/.merovingian/<ns>/namespace.json` | `merovingian namespace add` · authoring commands reading the tenant's `merovingian.toml` (`namespaceFile`) | Where this namespace is served. `{ transport: "remote", url }` ⇒ `login`/`build`/`graph` go over HTTP to that service. `{ transport: "surreal", url }` ⇒ served locally against that SurrealDB url (the per-tenant server, registered by `deploy`/`reset`). Absent ⇒ served locally against the defaults. |
| `~/merovingian/<ns>/repos/` | `merovingian build` (`repoStore`) | The central clone store for this tenant's okf repos. |
| `~/merovingian/<ns>/repos/<name>/` | `build` → `materializeOkf` (`repoDir`) | One cloned okf repo. Keyed by the **bare** repo name (`basename` of the slug), so `acme-labs/kb-content` clones to `.../repos/kb-content`. |

`repoDir(storeRoot, repo)` flattens a full slug (`org/name`) to `basename(name)` — multi-org KB is
supported (the org part still drives the clone) but the local dir is flat.

## The session

`currentuser.json` is the local identity for a tenant:

- **Local** (stub/surreal): the `user` field is the stub/DB user id you passed to
  `merovingian login <ns> <user>`.
- **Remote**: no user arg — `login` grabs the local `gh` token, calls the service's `/whoami`, and
  stores the resolved `{ user, github }`. Identity comes from GitHub, not from you.

Source: `src/commands/login.ts`.

## How the store mounts into a workspace

`build` runs inside a **workspace folder** (the cwd) and materializes files there, separate from the
two machine roots above:

```
<workspace>/
  CLAUDE.md                      # the scoped index
  .mcp.json                      # tools + system MCPs, by name
  .claude/settings.local.json    # marketplaces, plugins, additionalDirectories, env (gitignored)
  .claude/skills/<name>/…        # library skills, materialized (wiped + rebuilt each build)
  .claude/agents/<name>.md       # library agents, materialized (wiped + rebuilt each build)
  .merovingian/build.json        # stamp: what built this folder
  context/<bucket>               # symlink → ~/merovingian/<ns>/repos/<name>
```

Each entitled okf bucket is cloned/fast-forwarded into `~/merovingian/<ns>/repos/<name>` and
symlinked to `context/<bucket>` in the workspace; the real store path also goes into
`permissions.additionalDirectories` so the agent reads the real content through the link. Clones run
with the user's `gh` credentials (the permission boundary — fail-closed on no access) and
**sequentially** (parallel `gh`/git races the credential helper). Source: `src/store/okf.ts`,
`src/projection/emit.ts`.
