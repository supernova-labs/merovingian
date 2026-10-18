# Access lifecycle

## Onboard

1. Edit the tenant's `users` entry: stable ID, name, assignments, GitHub login and, when
   known, email and Slack ID. These identifiers remain administrator-maintained.
   Set `journalAdmin: true` only for the intended journal administrator.
2. Roles `owner` and `member` share the purpose's access. An owner assignment cannot
   carry a scope; model responsibility for a slice as a child purpose.
3. Review `deploy plan --graph <path>` and apply the authorized Surreal changes.
4. Set a password with `passwd <tenant> <user>`. Supply it through private stdin or
   `MEROVINGIAN_NEW_PASS`; never command arguments or a shared transcript.
5. Inspect `deploy github-plan --graph <path>`. For repositories in `github.repositories`,
   review and execute `github-apply` using the exact returned revision. This is independent
   of Surreal deploy. Supply missing team/organization membership explicitly when authorized.
6. Give the member the tenant setup skill plus private connection details: `SURREAL_URL`,
   `SURREAL_NS`, `MEROVINGIAN_DB`, `MEROVINGIAN_USER`, `MEROVINGIAN_PASS`.
   Setup proposes all authorized plugins; the human confirms installation.

## GitHub reconciliation

The graph's purpose reach and `owns`/`reads` determine write/read entitlement. A marketplace
consumer receives read; contributor ownership must be declared. Repository access exposes
all files in that repository, so purpose trees and marketplace boundaries must account for this.

Review teams must already exist, have write access and exactly the derived reviewers.
Any other human with a purpose that owns the repository can review; the PR author cannot
approve their own PR. Required approvers use a separate singleton team. An explicitly configured
PR-only bypass permits manual exceptions, including for another author's PR; it is not an
author-sensitive rule. Force push and deletion are prohibited by a separate rule without bypass.

The engine manages declared repository ACLs, including direct excess grants it did not create.
Excess inherited/team access blocks automatic reconciliation; inspect the shared membership
before narrowing it. Organization base access must be none; organization administrators are
explicit exceptions. Repositories missing from GitHub produce an error, not automatic creation.

## Verify or offboard

Use the member's own catalog and GitHub identity to verify the result. Do not equate a successful
operator clone with the member's access. Record invitation status until acceptance is confirmed.

For assignment changes or offboarding, review both provider plans. Deleting a user is blocked
when journals still reference that author; do not edit or delete history to force it. Remove
assignments to suspend purpose access and decide separately how to retain the identity/history.
When a user can be deleted, the engine removes its credential. Removing a repository from
`github.repositories` relinquishes management rather than revoking every grant.

Revoking future access cannot erase existing clones, cached content or earlier exports.
Do not remove a person's local files as a side effect of access reconciliation.
