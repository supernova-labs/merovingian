# Preparing production

Use durable SurrealDB storage on the intended controlled network, with administrative and
individual access kept separate. Back up the whole tenant and rehearse restoration. The
historical export command preserves selected old tables and decision files; it is not a
complete database, credential or disaster-recovery backup.

The current runtime uses direct individual SIGNIN for Catalog/Journal. There is no build/auth
service to deploy. Protect operator credentials and provisioning keys independently of member
configuration. The graph console remains a localhost-only unauthenticated administrative view.

## Cutover order

1. Review the next-major graph and publish the required tenant plugin content through its
   authorized release process. Verify clients can actually install it.
2. Prepare individual setup, administrative credentials and the reviewed provider plans.
3. Stop old writers, capture/verify the final historical snapshot, and rehearse isolated restore.
4. Apply the authorized Surreal and GitHub changes separately. New Surreal deploys deny record
   identity access to historical tables without deleting their data.
5. Verify new personal runtime and native resources on the required four macOS interfaces.
   Re-plan provider state and record failures or outstanding invitations explicitly.

Do not run the old deployment schema against the cut-over tenant: it can restore historical
permissions. Retain old checkouts and files as data until deliberately cleaned up. There is
no supported dual-runtime period. An archive does not itself authorize a production change.

Release approval requires reviewed documentation, passing relevant tests and an identifiable
candidate. See [release checklist](releasing.md), [history](history-and-cutover.md), and
[desktop evidence](../testing/desktop-mcp-smoke.md). Evidence records what ran; it is not a claim
that every remaining release check has passed.
