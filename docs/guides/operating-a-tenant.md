# Operating a tenant

Use the published 1.0.0 CLI and confirm `merovingian --version`. In these examples,
`merovingian` stands for that executable. For development against a matching checkout,
use `bun /absolute/path/to/merovingian/bin/merovingian.ts` explicitly.

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

In the development checkout, planning verifies schema inventory before reading the graph.
An absent or schema-only database has an all-create plan, including its configuration singleton.
An existing graph with missing structural tables stops planning with an upgrade diagnostic;
verify the target and backup before using `deploy apply` to prepare the schema, then review
any deletions before confirming. Missing configuration alongside surviving structure, history or business data
is an error requiring investigation/restoration, not an empty database. Failed inventory or
record reads never authorize an all-create plan. Duplicate configuration records or a configuration
record for a different tenant also stop planning. Use `deploy plan` for this diagnosis:
`deploy apply` prepares schema and permissions before reading current state, so it can mutate
the database even when it subsequently refuses an incomplete configuration.

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
