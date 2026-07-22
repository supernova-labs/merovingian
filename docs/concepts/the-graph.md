# The graph

Merovingian models an organization as a **graph of purposes**. One file — [`graph.yaml`](../reference/graph-yaml.md) —
is the source of truth. Everything the platform does is a function of that graph: `build` projects a
person's workspace out of it, `deploy` reconciles it with the database. This page explains the model
— what the pieces are and how they fit — rather than every field. For the exhaustive schema, see the
[`graph.yaml` reference](../reference/graph-yaml.md). For the conceptual base this realizes, see the
[five primitives](../foundation/primitivos.md).

## The seven pieces

A graph is built from a small set of node types plus one edge type:

- **Purpose** — an area of responsibility ("círculo"). The organizing unit.
- **Bucket** — a unit of knowledge with a single owner and a single sensitivity.
- **Skill** — a codified procedure: first-party content from the tenant **library**, or an external
  plugin from a marketplace.
- **Tool** — a "tubo": a way to reach an external system (an MCP server + its credential).
- **User** — a person, anchored to a GitHub identity.
- **Assignment** — the edge that puts a user in a purpose, with a role and an optional scope.
- **Scope** — not a node: a row-level narrowing that runs *through* buckets, assignments, and the JWT.

## Purpose: the organizing unit

A purpose is an area of responsibility — what other tools might call a project, a team, or an agent.
Purposes form a **tree**: each has a `parent` (or `null` for the root), a `reason` (its "why"), and
a set of capabilities. The root is the shell everyone lands in; it routes people to the purposes
they belong to.

Two things make purposes the load-bearing primitive:

- **They bound what is available.** A purpose declares the skills, tools, and knowledge aligned to
  its work — and *nothing else*. That is deliberate scoping of capability, and prevention of context
  contamination: the finance circle is not the content circle.
- **They bound accountability.** Every purpose has exactly one owner (holacracy/RACI). Ownership is
  singular and total — which is why an owner edge cannot be sliced by scope.

Optionally, a purpose carries an inline **agent**: its persona. `agent: shell` (no `@`) is a
library agent — the prompt at `library/agents/shell.md` in the tenant repo; `agent: counsel@guild`
is an external plugin. A visible purpose loads its agent even when it declares zero skills, so the
persona is always present.

## Bucket: knowledge with one owner

Knowledge does not live loose in a purpose — it lives in **buckets**. A bucket is a recombinable
unit: a single owning purpose, a single sensitivity (`low`/`medium`/`high`), and a `backend` that
decides where it physically sits — a git repo (`okf-repo`, for prose) or Surreal tables (`surreal`,
for structured or sensitive data).

Purposes relate to buckets on two axes:

- `owns` — this purpose may **modify** the bucket. (The owning purpose is named on the bucket too;
  `owns` is the reciprocal capability edge.)
- `reads` — this purpose may **consume** the bucket, read-only.

This is what lets knowledge be **shared without fragmenting**. "What the company is", "the client
list", "the method" each live in exactly one bucket, owned by one purpose, and are `read` by the
purposes that need them — no replication, no copy drift. It is also the first of the primitive's
triple filter: *can this purpose consume knowledge from this location?* The second (can this user
reach this purpose?) and third (can this user, here, consume this data?) are answered by assignments
and scope.

## Skill and Tool: procedure and reach

**Skills** codify procedure — the "how" of the work. Distribution is **hybrid**
([ADR 0012](../decisions/consolidadas/0012-library-do-tenant-e-distribuicao-hibrida.md)), and
**local by default**:

- **First-party content lives in the tenant library** — `library/skills/<name>/SKILL.md` (plus
  supporting files) next to the `graph.yaml`. A skill name a purpose references resolves there *by
  convention*, with no catalog entry. The library is part of the desired state: `deploy` ships its
  content into the database, and `build` materializes each person's slice into their workspace —
  graph and prompts version together, atomically, in the same repo and the same PR.
- **External content comes through a marketplace** — the `skills:` catalog holds *only* explicit
  `plugin@marketplace` refs (third-party or community plugins; the governance plugin, ADR 0010, is
  repo tooling on the same channel). The `marketplaces:` registry is optional and exists only for
  these.

Skills attach to the purposes (and the ambient layer) that should load them, wherever they resolve
from. The catalog is fine-grained: several skills can resolve to one plugin, and skills can cross
marketplaces.

**Tools** ("tubos") are how the system reaches external systems — an MCP server (`command` + `args`),
its `env`, and a `keySource` that says where the credential comes from (`company` = a shared key
resolved server-side into the workspace's env; `none` = no secret). Purposes list the tools they
enable.

The asymmetry between them is deliberate. Skills are validated — a name that resolves to neither
the catalog nor the library is an authoring bug. Tool refs on a purpose are **free strings**,
intentionally not validated: the tool registry is a partial "tools we actually run" list, so
checking refs against it would false-fail on tools that exist but aren't yet catalogued.

**Ambient** skills are the exception to purpose-scoping: a small set (e.g. `journal`, `friction`)
that loads in *every* workspace, with no agent, because they belong to the system rather than any one
purpose.

## User, Assignment, and Scope: who is where

A **user** is a person, anchored to a GitHub login. They hold a set of **assignments** — one per
purpose they belong to. Each assignment has:

- a `role` — `owner` (accountable) or `member` (works there);
- an optional `scope` — the instance the purpose is held over (e.g. a region, a client slice).

The subtle rule: **access and role are independent axes.** If you belong to a purpose you get its
workspace — the same workspace — whether you are owner or member. Role gates only *accountability*
(owners govern, deploy, and decide). Because an owner is accountable for the *whole* purpose, an
owner edge cannot carry a scope; to own a slice, you make that slice its own sub-purpose.

**Scope** is the row-level filter. A row-scoped bucket (`rowScope: account`), a scoped assignment
(`scope: north`), and a scoped JWT identity together decide which *rows* a person sees inside a
high-sensitivity bucket. This is the
third filter of the context primitive, and it is enforced by the **backend**, not the build:
`build` generates the scope; SurrealDB's record-level `PERMISSIONS` honor it against the identity in
the JWT. Generation is not enforcement.

## Decisions: the domain, the log, and the record

The third primitive has storage of its own
([ADR 0013](../decisions/consolidadas/0013-dominio-de-decisoes-log-e-jurisprudencia.md)). A purpose
declares the **decision domains** it owns — `decides: [pricing]` — under the same ownership rule as
buckets: one domain, one purpose.

Each domain carries two objects with different mechanics:

- **The log** (`decision_log`) — calls made *in flight*, during work, appended by members via the
  ambient `decisions` MCP (`register-decision`). Not policy yet: readable and writable by whoever
  reaches the owning purpose's lineage ("you log decisions where you operate"), drained by
  governance like the inbox. A log entry can cite the ratified records it applied — jurisprudence
  telemetry (many citations = load-bearing, zero = dead letter).
- **The record** (`decision`) — ratified jurisprudence: authored as files in the tenant repo's
  `decisions/<domain>/`, ratified by a governance commit, shipped by `deploy` like library content,
  readable tenant-wide. An `accepted` record is immutable — supersede it, never edit it.

The bridge between them is **promotion**: the governance drain pass reads the log, and what
converges becomes a record file in the same PR as any graph change. Every workspace is told the
epistemic posture: *records are law; logs are jurisprudence under construction* — a log is never
applied without human confirmation.

## How it becomes a workspace, and how it stays true

The graph is inert data until two operations act on it — see [build vs deploy](build-vs-deploy.md):

- **`build`** is projection. Given a person, it walks the graph — their assignments → the purposes
  they can see → the buckets those purposes own and read → the skills, tools, and agents that load →
  the scope on sensitive data — and emits exactly the workspace they are entitled to.
- **`deploy`** is reconciliation. The `graph.yaml` *plus the library content* is desired state;
  `deploy plan` diffs it against the live database field by field (content as short hashes), and
  `deploy apply` converges it — structure only, idempotent.

Before either runs, the graph is checked for internal coherence: parents exist, owned/read buckets
exist, every skill/agent resolves (external catalog or library content), plugin refs point at
registered marketplaces, no duplicate ids, and no scoped owner edges. Those invariants (listed in
the [reference](../reference/graph-yaml.md#validation-invariants))
catch authoring bugs as a reviewable diff, before anything touches a workspace or the database.

## The primitives, realized

The graph is the concrete form of the [five primitives](../foundation/primitivos.md):

| Primitive | In the graph |
| --------- | ------------ |
| **Purpose** | the purpose tree — centralized, scoping capability and accountability |
| **Context** | buckets (`owns`/`reads`) + `scope` — the triple filter: purpose → user → data |
| **Skills** | the tenant library (local by default) + the external catalog, attached per-purpose and ambient |
| **Tools** | the tool registry ("tubos") with per-tool `keySource` |
| **Decisions** | `purpose.decides` — decision domains, each owned by one purpose; an in-flight log + ratified records in `decisions/`, promoted by governance |

Everything downstream — the workspace a person opens, the rows they can query, the plan `deploy`
proposes — is a pure function of this one graph. Change the graph, review the diff, and the whole
system moves with it.

---

**Next:** the [`graph.yaml` reference](../reference/graph-yaml.md) · [build vs
deploy](build-vs-deploy.md) · [enforcement](enforcement.md) · [authoring the
graph](../guides/authoring-the-graph.md).
