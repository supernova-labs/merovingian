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
  CLAUDE.md                       # Claude Code scoped instructions
  .mcp.json                       # Claude Code MCPs
  .claude/settings.local.json     # Claude marketplaces, permissions and env (0600)
  .claude/skills/<name>/…
  .claude/agents/<name>.md
  AGENTS.md                       # Codex scoped instructions
  .codex/config.toml              # Codex agents registry + MCPs + permissions (0600)
  .agents/skills/<name>/…
  .codex/agents/<name>.toml       # role config referenced by config.toml
  .merovingian/build.json         # schema 3: ownership + degradations + requested purposes (0600)
  context/<bucket>                # symlink → ~/merovingian/<ns>/repos/<name>
```

Claude and Codex artifacts are prepared before any write and applied as one rollback-capable
transaction. Cleanup removes only files in the previous per-emitter inventory; sibling files are
preserved. A foreign `AGENTS.md`, `CLAUDE.md`, or config is never overwritten.

Codex requires the user to trust this exact workspace once before it loads the generated
`.codex/config.toml`. Until then, the root `AGENTS.md` remains the visible setup guide but projected
MCP servers and OKF filesystem permissions are intentionally inactive.

Each entitled okf bucket is cloned/fast-forwarded into `~/merovingian/<ns>/repos/<name>` and
symlinked to `context/<bucket>` in the workspace; the real store path also goes into
`permissions.additionalDirectories` so the agent reaches the real content through the link. Codex
grants `write` to mounts owned by a visible purpose and `read` to mounts that are only read by the
projection. Clones run with the user's `gh` credentials (the permission boundary — fail-closed on
no access) and **sequentially** (parallel `gh`/git races the credential helper). Source:
`src/store/okf.ts`, `src/projection/resolve.ts`, `src/projection/emit.ts`.

## Build receipt

The mode-0600 `.merovingian/build.json` receipt is local operational metadata, not tenant desired
state. Schema 3 adds `requestedPurposes`: an empty array records a full-entitlement build, while a
non-empty array retains the normalized purpose roots passed to `--purposes` before the resolver
expands descendants. This lets the ambient `update-workspace` skill reproduce the projection.

The CLI reads both schemas 2 and 3 for ownership and plugin reconciliation. Because schema 2 did
not record the request, the skill asks the human to supply it or explicitly choose full entitlement;
it never derives authority from generated Markdown. Any successful current build writes schema 3.
