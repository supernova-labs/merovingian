# Next-major candidate review — 2026-10-18

Historical pre-release review. Version 1.0.0 was subsequently approved and published
on 2026-10-18; see the [release notes](../releases/1.0.0.md). The evidence and
pre-release gates below record the candidate review at that time.
Engine runtime reviewed: `c38ac75` on `codex/major-catalog-setup`. Follow-up changes
correct a stale integration-test assertion and document release evidence; they do not
change runtime code. The operator approved version **1.0.0** on 2026-10-18.
At that checkpoint, the package version and draft notes reflected the version
decision; publication and cutover still needed approval. The reviewed plugin was 0.6.0.

## Evidence

- Bun 1.3.9, SurrealDB 3.0.1, disposable in-memory loopback database.
- Full engine suite: **191 passed, zero failures, zero skips**, 530 assertions.
- Typecheck passed. Administrative plugin and marketplace native validators passed in
  the preceding documentation review; those manifests are unchanged here.
- Real npm tarball extracted outside the checkout, with independently installed
  dependencies. CLI help, graph-only init and archive verification passed.
- Tarball SHA-256: `575c8759f14b48cce5e611d203f99940894873232a8ee6886fb0b4ec3f9367b7`.
  This identifies the local 0.5.3-labelled artifact, not a release version.
- Tenant Core setup: **30 tests passed, zero skips**, including real stdio processes
  launched from the extracted package with synthetic individual credentials in two
  empty folders and both client configuration formats. Wrong passwords were rejected.
  No native personal configuration or real tenant data was modified by this probe.
- The clean-database run exposed an outdated test querying `decision_domain`. The
  structural-access test now tests current structural tables; historical tests assert
  all four retired tables are absent on fresh databases and retain migration-lockdown
  coverage. No runtime permission was weakened to make a test pass.

This package install resolved dependencies independently of the checkout lockfile,
including SurrealDB SDK 2.1.1. It complements the locked engine test suite.

## Versioned artifact — 1.0.0

After version approval, a new tarball was generated and extracted in isolation.
Independent dependency installation, `--version` (1.0.0), help, graph-only init and
package inventory checks passed. Typecheck and all four CLI tests also passed.
SHA-256: `5eb2a12ed7a96339a4c25fbfbaedd7e23dceacba195ced5e8274116a1735072f`.
Only package version and documentation changed since the full runtime/setup checks
above; no new database or desktop sessions were needed for this version check.

## Gates recorded before publication

1. Publish/review tenant plugin changes before activating graph references to them.
   Private repository names, commits and sequence belong in the tenant runbook.
2. Confirm the remaining native-client acceptance evidence in
   [desktop smoke](desktop-mcp-smoke.md). The old Claude desktop session did not reload
   personal MCP definitions. Earlier project-config desktop operation and current
   personal process/terminal probes are distinct evidence; do not call them a fresh
   personal desktop acceptance test or open new chats without authorization.
3. Approve publication of the versioned 1.0.0 candidate after reviewing
   [release notes](../releases/1.0.0.md) and the final artifact evidence.
4. At the agreed cutover window, stop old writers, capture the final historical archive,
   verify a complete operational backup/restore path, then execute reviewed plans.
   The historical archive alone excludes credentials and unrelated tenant tables.
5. Verify new personal access and zero unexplained provider drift after cutover.

## Recovery boundary

A failed preflight stops before production changes. After schema preparation, a failed
apply is not proof that nothing changed. Keep the maintenance window, inspect actual
state, and prefer a reviewed forward repair. Do not run the old deploy or restore old
permission definitions over the active tenant: that can reopen retired interfaces.
Full database rollback requires an explicit operator decision, a complete backup, and
preservation of any Journal entries written since it. Rehearse restoration in isolation.

See [cutover](../guides/history-and-cutover.md) and [release procedure](../guides/releasing.md).
