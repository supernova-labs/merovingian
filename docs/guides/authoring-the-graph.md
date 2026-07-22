# Authoring the graph

How to change a tenant's `graph.yaml` — and its `library/` — safely: the edit → plan → apply loop,
why rename is a delete + create + re-point, and the invariants the validator enforces.

The graph **plus the tenant library** is desired state ([ADR
0012](../decisions/consolidadas/0012-library-do-tenant-e-distribuicao-hibrida.md)). You never
mutate the database directly — you edit `graph.yaml` and/or `library/` (in a PR) and reconcile with
`deploy`. Grounded in `src/graph/plan.ts` (validation + diff) and `src/graph/apply.ts` (converge).
For the full lifecycle, see [`operating-a-tenant`](./operating-a-tenant.md); for the schema, see
[`reference/graph-yaml`](../reference/graph-yaml.md).

## The change loop

Run authoring commands **inside the tenant repo** (they read `./graph.yaml`; the namespace comes
from the yaml). Substitute `bun /path/to/merovingian/bin/merovingian.ts` if you have not installed it
(see [CLI reference](../reference/cli.md#invocation)).

```bash
# 1. Edit graph.yaml (a purpose, bucket, tool, skill, user, assignment) AND/OR library/
#    (a skill's SKILL.md, an agent's prompt) — the same loop covers both.

# 2. Plan — see exactly what would change, field-level. Read-only.
merovingian deploy plan
#   exit 0 = in sync · 1 = drift pending · 2 = yaml invalid (fix first)

# 3. Apply — converge Surreal to the graph.
merovingian deploy apply          # refuses (exit 1) if any deletion is pending
merovingian deploy apply --yes    # allow deletions
```

**Always plan before apply.** The plan is the review; `apply` is the commit. If the plan shows more
than you intended, your edit was wrong — fix the yaml, don't force the apply.

### Reading the plan

`deploy plan` renders three change classes (`src/commands/deploy.ts`):

```
+ create  <kind> <id>          create — in the yaml/library, absent from Surreal
- delete  <kind> <id>          delete — in Surreal, absent from the yaml/library
~ change  <kind> <id>          update — same id, different fields
           field: from → to    (scalar change)
           field: +added -removed   (set change)
```

Kinds: `purpose`, `bucket`, `tool`, `skill`, `marketplace`, `agent` (library agent content),
`config` (the ambient singleton), `user`, and `responsible` (a user→purpose assignment edge).
Set-valued fields (`owns`, `reads`, `skills`, `tools`, `decides`, `tables`) diff order-blind;
command `args` diff as an ordered sequence.

**Library content diffs as hashes**, one line per changed file — never full text. A library
skill diffs its file-name set plus a sha256-8 scalar per changed file; a library agent diffs a
single `content` hash:

```
~ change  skill journal
           files.SKILL.md: 6ecffe0c → e0bd1151
~ change  agent shell
           content: 41f0c1d2 → 9ab4e77c
```

The plan only proves drift; the reviewable full diff is the tenant-repo PR.

### What `apply` does, in order

1. Validate the yaml (aborts with authoring errors if invalid).
2. Ensure schema.
3. Read current state from Surreal, compute the plan.
4. **`--yes` gate:** if the plan contains *any* deletion and `--yes` is absent → `needs-confirm`,
   nothing written.
5. **Referrer pre-flight (atomic):** for each record delete, check live runtime rows still pointing
   at it. If any is blocked → `blocked`, nothing written.
6. Upsert all desired records → reconcile edges → delete removed records.

Upserts are full-content replace, so a field you removed from the yaml (e.g. a purpose's `agent`)
becomes `NONE` in Surreal. `apply` never touches business data (`client`, `inbox`) — structure only,
safe by design.

## Rename = delete + create + re-point

**Ids are stable slugs and never mutate.** There is no rename operation. Because the plan keys every
resource by its id, changing an id reads as *delete the old id + create the new one* — and every
reference to the old id must move in the **same** edit, or you'll orphan things or hit a validation
error.

To rename a purpose `growth` → `revenue`:

1. Change the purpose's `id: growth` → `id: revenue`.
2. **Re-point every reference** in the same change:
   - child purposes' `parent: growth` → `parent: revenue`,
   - buckets' `owner: growth` → `owner: revenue`,
   - the `agentByPurpose` entry, if any,
   - every user assignment `{ purpose: growth, ... }` → `{ purpose: revenue, ... }`.
3. `deploy plan` — you should see `- delete  purpose growth`, `+ create  purpose revenue`, and
   updates re-pointing the referrers.
4. `deploy apply --yes` (the delete needs confirmation).

If a live runtime row still references the old record (today: `inbox.user → user` for a user
rename), the delete is **blocked** and apply aborts atomically. Re-point or remove that row first,
then retry. (Source: `src/graph/apply.ts` referrer check.)

Ids to keep stable: purpose ids, bucket ids, user ids, skill/tool/marketplace keys. Renaming any of
them is a delete+create+re-point.

## The invariants (what the validator enforces)

`deploy plan` and `deploy apply` both run `validateGraph` first; violations block with exit `2`
(plan) / `invalid` (apply). These are the rules, from `src/graph/plan.ts`:

**Uniqueness**
- No duplicate `purpose` ids.
- No duplicate `bucket` ids.

**Referential integrity**
- A purpose's `parent` must be `null` (root) or an existing purpose id.
- Every bucket in a purpose's `owns` / `reads` must exist.
- Every skill a purpose lists (and every `ambient.skills` entry) must **resolve**: either an entry
  in the external catalog or `library/skills/<name>/SKILL.md`. Otherwise:
  `purpose "<id>": skill "<s>" not in catalog and no library/skills/<s>/SKILL.md`.
- Every bucket's `owner` must be an existing purpose id.
- Marketplace checks apply **only to plugin-variant refs**: an external catalog skill's
  `marketplace`, and an external (`plugin@marketplace`) agent's `marketplace`, must be registered.
  A fully-local graph needs no `marketplaces:` at all.
- A library agent (`agent: <name>`, no `@`) must have its file:
  `agent of "<pid>": no library/agents/<name>.md` otherwise.
- An `agentByPurpose` entry's purpose must exist.
- Every user assignment's `purpose` must exist.

**The owner-is-unscoped invariant (ADR 0008)**
- An `owner` assignment can **not** carry a `scope`. An owner is accountable for the *whole* purpose.
  If someone should own only a slice, model that slice as its own child purpose and make them owner
  of the child.

```yaml
# INVALID — owner edge with a scope:
- { purpose: delivery, scope: north, role: owner }   # ✗ validator rejects

# VALID — a scoped member, or ownership of a sub-purpose:
- { purpose: delivery, scope: north, role: member }  # ✓ scoped member is fine
```

**Deliberately NOT validated:** a purpose's `tools` are free strings, *not* checked against the tool
catalog. The catalog is a partial "tools we actually run" registry, so validating tool refs against
it would false-fail. (Source comment in `src/graph/plan.ts`.)

## Local vs external: where a skill or agent should live

Content is **local by default** (ADR 0012). The decision rule:

- **First-party content** — a prompt this tenant owns and evolves (domain skills, personas,
  ambient) — goes in the library. Add `library/skills/<name>/SKILL.md` (plus supporting files) or
  `library/agents/<name>.md`, reference it by bare name (`skills: [write]`, `agent: shell`), and
  **do not** touch the `skills:` catalog or `marketplaces:`. Only referenced names deploy —
  an unreferenced library folder is dormant.
- **External content** — a third-party/community plugin whose updates should flow from its
  publisher — comes through a marketplace. Add the channel to `marketplaces:` (name →
  `owner/repo`), then reference it explicitly: a catalog entry `audit: compliance@guild`, or an
  inline `agent: sales-advisor@guild`. The `@` is the discriminator; there is no default
  marketplace and no shorthand.

Moving a skill from external to local is: drop the catalog entry, create the library folder, keep
the name. The plan will show the skill's `source: plugin → library`.

## Editing a prompt IS a governance change

A library skill's `SKILL.md` or an agent's `.md` is desired state like any purpose: edit it, `deploy
plan` (the change shows as a hash scalar), `deploy apply`, commit — one PR carries the structure
*and* the behavior atomically. Propagation is the normal loop: affected people re-`build` and their
`.claude/skills/` / `.claude/agents/` are rebuilt with the new content.

## Access is role-blind (ADR 0008)

`owner` vs `member` gates **accountability, not access** — both roles project the same workspace for
a given (purpose, scope). Choose `owner` for the accountable person, `member` for everyone else; do
not reach for `owner` to grant more access, because it grants none.

## After applying

Structure (and library content) changed in Surreal; workspaces are stale. Everyone affected re-runs
`merovingian build <ns>` in their workspace folder to re-project — the build wipes and rebuilds
their `.claude/skills/` + `.claude/agents/` slice. `build` is a projection — safe to re-run any
time.

## Related

- [`reference/graph-yaml`](../reference/graph-yaml.md) — the full schema.
- [`operating-a-tenant`](./operating-a-tenant.md) — the end-to-end lifecycle.
- [`reference/cli`](../reference/cli.md#deploy-plan---graph-path) — `deploy plan` / `deploy apply` exit codes.
- [`concepts/the-graph`](../concepts/the-graph.md) — the model.
- [`concepts/build-vs-deploy`](../concepts/build-vs-deploy.md) — projection vs reconciliation.
