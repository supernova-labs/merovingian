# GitHub deployment

GitHub deployment reconciles private organization repositories already referenced
by the tenant graph. It runs separately from Surreal deployment and uses `gh`'s
administrative authentication on github.com. It does not create repositories.

```yaml
github:
  administrators: [operator] # graph user IDs; explicit operational exceptions
  managedTeams: # optional adoption of existing organization/team-slug identities
    - acme/kb-reviewers
    - acme/marketplace-reviewers
    - acme/marketplace-approver
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
stale approval and any blockers. It removes obsolete managed-team members first, verifying each removal before
enabling any new approval bypass. It then configures and verifies protections before
team grants, membership additions and direct access changes. API failure stops subsequent operations and reports what
already ran; there is no cross-repository rollback. Final auditing distinguishes
drift, failed verification and invitations awaiting acceptance from effective access.

Use `--scope permissions` or `--scope protections` to review and apply a provider
subset. Managed-team drift requires `--scope all`; neither subset silently changes
team membership or grants. Scope is included in the approved revision. A permissions-only operation
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
  Excess unmanaged-team/inherited access blocks apply with a diagnostic. Narrow
  that grant explicitly; this command never changes organization membership.
- Review teams must already exist, have repository write access and exactly the
  graph-derived reviewer membership unless explicitly adopted through `managedTeams`.
  Adopted teams are reconciled to that membership and exactly `push` access. The
  mandatory-approver team remains a separate singleton. Read-only members cannot review under
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

## Managed team boundaries

`github.managedTeams` explicitly adopts existing teams by `organization/slug`.
Existing configurations retain their validation-only behavior until they opt in.
Missing teams are not created; create them separately and inspect a fresh plan.
The authenticated GitHub user must be an active organization owner, with sufficient
organization read/write permissions. The adapter also requires a classic/OAuth
credential advertising `repo` and organization scopes. Fine-grained/App tokens or
missing scope evidence are rejected for team management because restricted visibility
cannot prove the absence of private grants. Repository administration alone cannot prove
that a team has no grants to other private repositories.

For each managed team, the plan includes members and roles, pending invitations,
repository grants, hierarchy, organization membership, and every affected repository.
The team boundary inventory participates in the approved revision. Organization
membership and invitation data is limited to expected reviewers; unrelated people
and invitations are not printed and do not invalidate approval. New members are added
with the `member` role; existing team roles are preserved. Removed graph assignments
remove obsolete team membership, while any remaining read access is reconciled separately.
No organization invitation is issued implicitly.

A shared team is supported only when **every repository it can access** references
it in the selected policies and all uses require exactly the same membership. Any
external repository grant, conflicting reviewer/approver composition, parent or child
team blocks application. Use dedicated teams where these boundaries cannot be met.
Unknown grants and unaccounted effective access also block application.

Pending organization or team invitations are not active access. Complete onboarding
or explicitly cancel obsolete invitations, then re-plan. Team membership cannot be
changed while its pending invitations are unresolved. Repository invitations remain
visible in the final audit and prevent a successful convergence status.

Membership removals are verified before any new bypass is enabled; team grants are
narrowed before adding members. Each team mutation is re-read, and the final audit
checks actual membership, permissions and protections. Failed or ignored mutations
stop later operations; no rollback is claimed. Re-plan to inspect remaining drift
and approve recovery. A membership-only change leaves matching rulesets untouched.
There remains a race with out-of-band administrators between reads and writes.

The adapter uses GitHub's [team membership](https://docs.github.com/en/rest/teams/members)
and [team repository](https://docs.github.com/en/rest/teams/teams) APIs. These inventories
are required even when a managed team has no repository grant yet.

Tests use a synthetic API double and do not change production permissions. Before
rolling out to another account, verify its feature support in an isolated repository;
inspect the resulting rulesets and require a fresh plan with no unexplained drift.
