# Merovingian in one page

Merovingian models a tenant as a graph of purposes. Each person has assignments;
purpose reach determines authorized repositories, plugins and tool requirements.
The database enforces access. A catalog response describes entitlement, not proof
that a plugin is installed or a GitHub grant is effective.

There are three independent operations:

1. **Deploy:** administrators reconcile the graph with SurrealDB and, separately,
   declared GitHub repositories and protections.
2. **Discover and set up:** an individual authenticates to Catalog; a tenant-owned
   setup skill proposes native plugin installation and repository preparation.
3. **Record:** Journal stores immutable text with authenticated authorship and
   optional references. Each person reads their own; explicit admins read all.

The Source repository contains the engine and a synthetic example. Real tenant
graphs, identities, credentials and operational history belong in private tenant
repositories and administrative storage. Plugin repositories hold behavior;
marketplaces advertise those plugins. General instructions remain in the graph.

Initial client support targets macOS, Claude Code terminal and desktop Code tab,
and Codex terminal and desktop. The four interfaces have separate acceptance
requirements. There is no generated-workspace or legacy-runtime support track.

See [architecture](architecture.md), [graph](the-graph.md), and
[operations](../guides/operating-a-tenant.md).
