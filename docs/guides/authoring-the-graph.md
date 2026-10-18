# Authoring desired state

Edit the tenant's graph through reviewable changes. New skill catalog entries and purpose
agents are explicit `plugin@marketplace` references. Declare the required native marketplace
bindings; no local library files are loaded. General instructions use `ambient.instructions`.

IDs are stable. A rename becomes create/delete and requires updating parents, bucket owners,
read/write edges and assignments together. Purpose parents must form a valid tree. Owner
assignments cannot carry scope; create a child purpose for ownership of a slice.

Review `deploy plan --graph <path>` for create/update/delete differences. Instructions are
shown by hash, not full text. External repository existence checks may be skipped when gh
is unavailable and do not prove a member's effective access. GitHub reconciliation is a
separate provider plan with its own explicit repository selection and approved revision.

Apply converges structural state and generated permissions. Schema preparation occurs
before deletion confirmation/referrer checks, so a blocked structural change is not proof
that no schema changed. Business rows and journal contents are preserved. Removed Surreal
buckets do not drop their tables; review residual data/permissions separately.

Surreal apply is not bound to a plan hash: verify the same desired state and fresh plan
before execution. GitHub apply is revision-bound and refuses changed remote state. Keep
unrelated work out of commits. Read [YAML reference](../reference/graph-yaml.md) for fields
and [history cutover](history-and-cutover.md) before the first new-major deployment.
