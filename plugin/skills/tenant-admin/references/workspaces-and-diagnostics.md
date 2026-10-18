# Setup and diagnostics

The tenant's setup skill owns native client configuration and plugin/repository preparation.
Source supplies Catalog and Journal; it does not generate a workspace. Preserve existing
client configuration and local work. Initial support covers macOS: Claude Code terminal,
Claude Code's desktop Code tab, Codex terminal and Codex desktop.

## Establish operation

Configure personal MCP definitions to launch the selected runtime's `mcp catalog` and
`mcp journal` with individual credentials. Consult `identity`, then `catalog` with the
client selection. Offer every authorized plugin and let the human approve installation.
Enable the marketplaces needed by those plugins using the native client's mechanism.

Reuse existing authorized KB clones when their origin matches. Propose cloning missing
repositories into a human-selected personal directory. Symlinks under `context` are not
required. Do not replace a conflicting directory, discard work or reset a branch to make
setup succeed. A failed access check is not an instruction to remove the clone.

On demand, compare catalog revision, native installed inventory and marketplace versions.
A catalog revision is not a plugin version. Distinguish updates from missing installations,
unsupported client bindings and unavailable sources. Do not add background hooks or polling.

## Diagnose

| Symptom | Inspect and respond |
|---|---|
| Authentication refused | Verify private endpoint/database/user settings and password; never fall back to root. |
| Catalog unavailable | Check reachability and deployed schema; do not infer an empty entitlement. |
| Missing purpose/plugin | Check assignments, graph plugin references and client marketplace bindings. |
| Plugin installed but unavailable | Check native enablement, scope and session reload. Request a new test chat only if needed and authorized. |
| Clone denied | Check the member's GitHub login, effective ACL, organization invitation and team membership. |
| Local directory conflict | Inspect origin and local changes; preserve it and propose another directory. |
| Instructions not seen | Confirm `ambient.instructions` is deployed and the agent consulted the catalog; MCP does not guarantee automatic injection. |
| Journal list incomplete | Check author/admin policy and pagination; purpose ownership grants no cross-user history. |
| Old command unavailable | Use the new workflow; do not restore retired build/inbox/decision commands. |

Use `login <tenant> <user>` then `graph <tenant>` for the optional personal CLI view.
Its password must remain available for subsequent reads; the session file is metadata,
not a stored credential. For generic data inspection, explicitly select the person's
password path; that diagnostic surface also retains a privileged operator/test mint path.
Report client and runtime versions alongside evidence, without dumping secret configuration.
