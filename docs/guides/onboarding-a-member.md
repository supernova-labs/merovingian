# Onboarding a member

The administrator creates the person's graph user and assignments, maintains their GitHub,
email and Slack identifiers, deploys the graph and sets an individual Surreal password.
GitHub access and review-team membership must also be reconciled. An invitation is not
active membership until accepted.

Privately provide the tenant's endpoint, Surreal namespace, tenant database, user ID and
password. The person receives the tenant setup skill; shared skill text need not disclose
private infrastructure. Setup configures Catalog and Journal in each client's personal MCP
definitions. No project `.env` is required and no root credential or signing key is shared.

Setup consults the catalog, suggests all authorized plugins and asks the human to approve.
It enables their marketplaces using native mechanisms, reuses matching KB clones and
proposes missing clones in the chosen personal directory. A workspace context symlink is
not necessary. Existing work, conflicting directories and unrelated settings are preserved.

Confirm actual identity/catalog, journal append/list, plugin discovery and authorized KB
reading. Repeat on the required macOS clients: Claude Code terminal and desktop Code tab,
Codex terminal and desktop. Session reload may be needed after configuration changes;
an installed plugin is not proof that an existing conversation has discovered it.

Updates start on demand. Compare catalog revisions, marketplace versions and installed
inventory independently. Tool credentials outside Catalog/Journal use native integrations;
the motor does not distribute their secrets. See [personal MCP configuration](../reference/catalog-and-journal.md).
