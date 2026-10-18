# GitHub deployment

GitHub deployment reconciles private organization repositories already referenced
by the tenant graph. It runs separately from Surreal deployment and uses `gh`'s
administrative authentication on github.com. It does not create repositories.

```yaml
github:
  administrators: [operator] # graph user IDs; explicit operational exceptions
  repositories:
    acme/kb:
      reviewTeam: kb-reviewers
    acme/marketplace:
      reviewTeam: marketplace-reviewers
      requiredApprover: operator
      approverTeam: marketplace-approver
      allowApproverPullRequestBypass: true
```

This is a schema example, not a complete graph. Every referenced user needs a unique
GitHub login. Repositories must also occur as KBs or marketplace sources in the
graph. Declare a marketplace repository as a bucket and assign it through `owns`
to identify its contributors; plugin consumers receive read access. Purpose members
and owners have the same entitlement. Multiple assignments combine their access.
The member catalog never exposes the administrative policy.

`allowApproverPullRequestBypass` grants the singleton mandatory-approver team
manual bypass of the approval rules **through pull requests only**. It also permits
that person to bypass review on someone else's PR; limiting its use to their own
PRs is an operating convention, not an enforced condition. No custom check is used.
Branch integrity lives in a separate ruleset with no bypass: force pushes and branch
deletion remain prohibited. The planner validates singleton membership on each run.

## Review and apply

```sh
bun bin/merovingian.ts deploy github-plan --graph /path/to/graph.yaml
bun bin/merovingian.ts deploy github-apply --graph /path/to/graph.yaml --approve sha256:REVIEWED_DIGEST
```

Plan is read-only JSON with inventory, changes, blockers and a revision. Apply
re-reads all selected repositories and requires that exact revision. It refuses
stale approval and any blockers. It configures and verifies protections before
applying access changes. API failure stops subsequent operations and reports what
already ran; there is no cross-repository rollback. Final auditing distinguishes
drift, failed verification and invitations awaiting acceptance from effective access.

Use `--scope permissions` or `--scope protections` to review and apply a provider
subset. Scope is included in the approved revision. A permissions-only operation
does **not** establish or certify PR protection; the default `all` includes both.
Plan exit codes: 0 no changes, 1 drift, 2 blockers. Apply returns 0 only for verified
convergence with no outstanding invitations. Other outcomes return nonzero.
No database credential is needed for these commands.

## Operational boundaries

- Only repositories listed in `github.repositories` can be modified. Removing a
  repository from that list relinquishes management; it does not revoke all access.
- Organization base access must be `none`. Organization owners must be declared
  administrative exceptions. Missing administrative metadata fails closed.
- Direct grants are authoritative, including grants not created by Merovingian.
  Excess team/inherited access blocks apply with a diagnostic. Narrow that grant
  explicitly; this command never removes organization or team membership.
- Review teams must already exist, have repository write access and exactly the
  graph-derived reviewer membership. The mandatory-approver team has one member.
  The command does not mutate shared teams. Read-only members cannot review under
  this policy, and the native GitHub review rule excludes PR authors.
- The owned `merovingian-reviewed-changes` and `merovingian-branch-integrity`
  rulesets target the default branch. Integrity is installed and verified before
  upgrading an older combined ruleset or granting any approval bypass.
  Other rulesets remain in force. The API's required-team-reviewer feature is beta
  and may be unavailable for an account. Failure is reported, never replaced with
  a weaker protection. Existing rulesets with the reserved name are managed by this
  policy; inspect the plan before adopting that name.
- Public/internal repositories, unknown/custom roles, unsupported actors and
  invitations without an identifiable user are not silently reconciled.

Tests use a synthetic API double and do not change production permissions. Before
rolling out to another account, verify its feature support in an isolated repository;
inspect the resulting rulesets and require a fresh plan with no unexplained drift.
