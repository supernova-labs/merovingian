# Catalog, setup and deploy

This page retains its historical URL. Workspace build has been removed.

| Operation | Reads | Changes |
|---|---|---|
| Surreal plan | Tenant YAML and database structure | No database writes; may register the tenant URL locally |
| Surreal apply | Validated YAML and current state | Structural records, derived access fields, schemas and permissions |
| GitHub plan | Declared policy and remote access/protections | Nothing |
| GitHub apply | A freshly verified approved revision | Managed repository access and rulesets |
| Catalog | Authenticated graph slice | Nothing |
| Tenant setup | Catalog, native client inventory, repository state | Human-approved client configuration, plugin installation and clones |
| Journal | Individual identity and visible references | New immutable entries only |

Deploy does not install plugins on member machines. Setup does not decide entitlement.
Catalog revision indicates a change in returned content, not a marketplace version.
Instructions are consulted through MCP; they are not emitted into root prompt files.

Apply preserves business rows and journal content. It is not a transaction: schema
and permission preparation can occur before a structural deletion is blocked.
GitHub partial failures stop later operations; re-plan to see the remaining work.
See [cutover](../guides/history-and-cutover.md) for retired surfaces and archives.
