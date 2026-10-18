# The purpose graph

A **purpose** has a stable ID, reason and optional parent. An assignment connects a
person to a purpose with role owner/member and optional scope. Both roles share access
to that purpose and its descendants; ownership expresses accountability. Owner
assignments cannot be scoped. Model ownership of a slice as a child purpose.

A **bucket** describes a repository, a Surreal domain or a platform resource. Purpose
`owns` and `reads` edges express write/read intent for repositories. Surreal domain
permissions are generated separately; repository write entitlement is not a universal
database write policy. `rowScope` identifies the field matched by scoped assignments.

A purpose can reference named skills and an `agent` plugin. Named skills resolve through
the explicit `skills` catalog, whose values are `plugin@marketplace`. The `agent` field
also takes that explicit reference. It advertises a capability; it does not create a
subagent process. Ambient skills are available across the tenant. Marketplaces may have
different native bindings for Claude and Codex.

`ambient.instructions` contains tenant-wide Markdown available through Catalog. It
must be suitable for every authenticated member. Its delivery does not imply that a
client automatically inserts it into its system prompt.

User GitHub/email/Slack identifiers are administratively maintained. Individual login
uses a Surreal password. `journalAdmin` independently allows reading every journal in
the tenant; it does not follow from being a purpose owner.

`decides` remains descriptive graph metadata with validated domain names. It no longer
provisions decision-domain tables, a decision log or ratified records. New decisions
can be recorded as journal text; approved operating rules belong in tenant capabilities.

A Git repository is the content-access boundary: access to one plugin in a repository
also exposes the other files there. Design purpose trees and private marketplaces with
that constraint. See [YAML reference](../reference/graph-yaml.md).
