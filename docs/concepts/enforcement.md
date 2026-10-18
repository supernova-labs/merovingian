# Access enforcement

Personal Catalog and Journal connections authenticate using Surreal record SIGNIN.
The database checks the individual password against its stored argon2 hash and issues
the token. Neither MCP accepts an identity override or falls back to administrator
credentials, GitHub authentication or a locally minted token.

Structural reads are filtered through purpose lineage and derived reader/ambient
fields. Permission checks use record links rather than subquery scans inside
PERMISSIONS. Tests compare the individually scoped catalog with the authorized slice
resolved from an administrative fixture and check cross-person isolation.

Journal author/time are database-stamped. Record identities can append and read their
permitted entries but cannot update/delete them. `journalAdmin` expands reads only.
References do not grant access; the MCP validates target visibility. Operational root
bypasses record permissions and belongs exclusively to trusted administration.

GitHub enforces repository access and branch protections independently. The reconciler
checks effective grants, inherited access, organization administrators, invitations and
review teams. A catalog declaration is never proof of remote access.

Generic `data`/`surreal-data` diagnostics also retain an operator/test token-mint path;
they are not the strict personal MCP authentication contract. Select the individual's
password explicitly when proving member access. The local console is unauthenticated
and shows the full graph; it is bound to localhost.

Existing historical tables are restricted to administration during new deploys. The
records remain intact. Access revocation does not remove already-downloaded content.
See [GitHub policy](../reference/github-deploy.md) and [cutover](../guides/history-and-cutover.md).
