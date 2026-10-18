# Operating a tenant

Use a matching next-major CLI checkout until the release is published. In the examples,
`merovingian` stands for that selected executable; from another directory use
`bun /absolute/path/to/merovingian/bin/merovingian.ts`.

## Reconcile desired state

Keep `graph.yaml` and the optional connection-only `merovingian.toml` in the private tenant
repository. Administrators maintain users, assignments, GitHub/email/Slack IDs and journal
administrators. Plugin behavior lives in its own repositories. Review tenant-wide text in
`ambient.instructions` for its full audience.

Run `deploy plan --graph <path>` before `deploy apply --graph <path>`. Structural deletions
require `--yes` after reviewing their impact. Apply can prepare schemas and permissions
before a deletion is blocked; it is not a transaction. A journal author cannot be deleted
while referenced: retain the identity and remove assignments if suspending access.
Do not modify immutable journal history to force deletion.

GitHub requires its own `deploy github-plan` and `github-apply --approve <revision>`.
These manage only explicitly declared repositories, with independently verified credentials.
See [GitHub deployment](../reference/github-deploy.md) for team and permission prerequisites.

## Onboard and maintain

Set individual passwords with `passwd`. Provide each member private connection settings
and the tenant setup skill. Setup consults the authenticated catalog, proposes native
plugins and KB clones, and waits for installation approval. It can reuse personal clones
across projects. There is no rebuild after graph changes: consult the catalog again and
run setup/diagnosis under demand when installation needs to change.

Use Journal to record free text and references. Review existing journals and tracked issues
through the governance skill; there is no pending or drained state in the motor.
For archived pre-major material use the administrative [history guide](history-and-cutover.md).

Keep operational evidence separated: deployed structure, effective GitHub grants, native
plugin discovery and actual KB reading are different checks. Preserve local work and
configuration on failures; report a partial setup rather than pretending convergence.
