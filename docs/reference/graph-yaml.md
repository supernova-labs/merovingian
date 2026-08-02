# `graph.yaml` reference

The `graph.yaml` is a tenant's **desired state** — the single source of truth for its
purpose-graph. Together with its sibling `library/` folder (contract v2, [ADRs
0012](../decisions/consolidadas/0012-library-do-tenant-e-distribuicao-hibrida.md) and
[0018](../decisions/consolidadas/0018-instrucoes-globais-do-tenant.md)) and `decisions/`
folder ([ADR 0013](../decisions/consolidadas/0013-dominio-de-decisoes-log-e-jurisprudencia.md)), it
declares everything: `build` projects it into scoped workspaces; `deploy` reconciles it — structure
**and** content — with SurrealDB. This is the authoritative schema: every field, its type, whether
it is required, its default, and the validation invariants.

The parser is a zod schema in [`src/graph/load-graph.ts`](../../src/graph/load-graph.ts)
(`parseGraph`, `loadLibrary`). The invariants are enforced by `validateGraph` in
[`src/graph/plan.ts`](../../src/graph/plan.ts) and run on every `deploy plan`. The resolved internal
shapes are in [`src/provider/types.ts`](../../src/provider/types.ts).

See also: [The graph](../concepts/the-graph.md) (the model), [Authoring the
graph](../guides/authoring-the-graph.md) (how to write one), [build vs
deploy](../concepts/build-vs-deploy.md), [Connection & secrets](../guides/connection-and-secrets.md).

---

## File resolution

Authoring commands resolve which file to act on, in order (`resolveGraphPath`):

1. an explicit `--graph <path>`,
2. the `MEROVINGIAN_GRAPH` env var,
3. `./graph.yaml` in the current working directory (the tenant repo).

If none exists, the command throws — the CLI never bundles a tenant graph.

`loadGraphFile` then also reads the **tenant library** at `library/` **next to the yaml**
(`loadLibrary(dirname(path))`), and the **tenant decisions** at `decisions/`
(`loadDecisions(dirname(path))`). An absent dir is simply empty content — not an error.

---

## Strictness (no back-compat)

The schema is `.strict()` at every level: **any unknown key fails loudly** instead of being
ignored. In particular, the contract-v1 keys are gone and will be rejected:

| v1 (rejected) | v2 |
| ------------- | -- |
| purpose `razao:` | `reason:` |
| bucket `scope:` (e.g. `by-client`) | `rowScope: <field>` (e.g. `account`) |
| top-level `defaultMarketplace:` | removed — catalog refs are always explicit `plugin@marketplace` |

---

## Top-level shape

```yaml
namespace: acme                    # required
ambient:                           # optional (default: { skills: [] })
  skills: [journal, friction]
marketplaces:                      # optional (default: {}) — EXTERNAL channels only
  guild:
    claude: acme-labs/guild
    codex: acme-labs/guild
tools: {}                          # optional (default: {})
skills: {}                         # optional (default: {}) — EXTERNAL refs only
agents: {}                         # optional (default: {}) — neutral local-agent metadata
purposes: []                       # required
buckets: []                        # optional (default: [])
users: []                          # optional (default: [])
```

| Key            | Type                          | Required | Default          | Meaning |
| -------------- | ----------------------------- | -------- | ---------------- | ------- |
| `namespace`    | string                        | yes      | —                | The tenant id. Keys the config singleton and every record's namespace. |
| `ambient`      | object `{ skills: string[] }` | no       | `{ skills: [] }` | Skills every workspace inherits, with no agent. See [ambient](#ambient). |
| `marketplaces` | map `name → harness bindings` | no       | `{}`             | Registry of **external** plugin channels, with native Claude/Codex distribution bindings. See [marketplaces](#marketplaces). |
| `tools`        | map `name → ToolDef`          | no       | `{}`             | The tool ("tubo") registry. See [tools](#tools). |
| `skills`       | map `name → plugin@marketplace` | no     | `{}`             | The **external** skill catalog. Local content needs no entry — it resolves from `library/`. See [skills](#skills--local-by-default). |
| `agents`       | map `name → { description }`  | no       | `{}`             | Harness-neutral metadata for local agents. Instructions remain in `library/agents/<name>.md`. |
| `purposes`     | array of Purpose              | yes      | —                | The purpose tree. See [purposes](#purposes). |
| `buckets`      | array of Bucket               | no       | `[]`             | Units of knowledge. See [buckets](#buckets). |
| `users`        | array of User                 | no       | `[]`             | People + their assignments. See [users](#users). |

---

## The tenant library (`library/`)

Behavioral content — skill and agent **prompts** — lives in the tenant repo, next to the yaml, by
convention ([ADR 0012](../decisions/consolidadas/0012-library-do-tenant-e-distribuicao-hibrida.md)):

```
<tenant-repo>/
  graph.yaml
  library/
    workspace.md                    # tenant-wide context/instructions; optional, tenant-owned
    agents/<name>.md               # one markdown file per agent persona
    skills/<name>/SKILL.md         # one folder per skill (+ any supporting files)
    skills/<name>/format.md        # supporting files travel with the skill
```

- **Resolution is by name.** Any skill name referenced by `purpose.skills` / `ambient.skills` that
  is **not** in the `skills:` catalog resolves to `library/skills/<name>/SKILL.md`. Any purpose
  `agent:` without an `@` resolves to `library/agents/<name>.md`.
- **`workspace.md` is ambient by convention.** Non-empty Markdown is trimmed only at its outer
  boundary, folded into `Definition.ambient.instructions`, persisted as `config.instructions`, and
  delivered unchanged to every identity. Missing, empty, or whitespace-only means no global
  instructions; no `graph.yaml` key is required.
- **The library is desired state.** `parseGraph` folds the referenced content into the
  `Definition`; `deploy` persists it into the database (skill records `{ source: "library",
  files }`, agent metadata + instructions into the `agent` table); `build` materializes each
  person's slice into both harness-native layouts: `.claude/skills` + `.claude/agents` and
  `.agents/skills` + `.codex/agents`. A member never needs to read the tenant repo.
- **Only referenced names fold in.** An unreferenced `library/skills/<x>/` folder is dormant — it
  is not deployed and not materialized.
- **Global means every authenticated tenant member.** Keep `workspace.md` concise and free of
  credentials, secrets, private topology, or purpose-specific information. It cannot grant access
  or supersede the generated identity and ratified decisions.
- **File paths are sandboxed.** A library skill file path containing `..` or starting with `/`
  throws: `library skill "<name>": unsafe file path "<rel>"`.

`merovingian init` seeds the library with copies of the Source templates (`shell` agent +
`journal`, `friction`, `pending`, `update-workspace`, `route` skills) and separately creates an
active, tenant-owned `workspace.md` with generic guardrails. `merovingian library update` refreshes
only template-owned skill/agent files and never touches `workspace.md` — see the
[CLI reference](./cli.md).

`update-workspace` is ambient in new tenants because it is useful to every member but runs only on
explicit request. Existing tenants must both copy the template with `library update --yes` and add
its name to `ambient.skills`; copying an unreferenced library directory does not deploy it.

---

## The tenant decisions (`decisions/`)

Ratified decision records — the tenant's jurisprudence ([ADR
0013](../decisions/consolidadas/0013-dominio-de-decisoes-log-e-jurisprudencia.md)) — also live next
to the yaml, one folder per **decision domain**, one `NNNN-slug.md` per record (`loadDecisions` in
`load-graph.ts`):

```
<tenant-repo>/
  graph.yaml
  library/
  decisions/
    pricing/0001-enterprise-floor.md   # folder = the domain; record id = pricing/0001-enterprise-floor
```

Each file is YAML frontmatter + a verbatim markdown body:

```markdown
---
status: accepted                       # proposed | accepted | superseded (required)
title: Enterprise tier price floor     # required
date: 2026-07-01                       # optional
supersedes: pricing/0000-old-floor     # optional — must resolve to an existing record
---
# Enterprise tier price floor

Enterprise engagements are never quoted below 20k. …
```

- **The folder is the domain; the record id is `<domain>/<slug>`.** The domain must be declared by
  some purpose's `decides:` and the slug must be a safe slug (invariants).
- **Records are desired state.** `deploy` ships them into the `decision` table — readable
  tenant-wide by any authenticated identity, never written at runtime. The plan diffs content as a
  short hash, like library files.
- **`accepted` is immutable.** Editing an accepted record's content draws a plan warning
  (`decision "<id>" is accepted (immutable) — supersede it instead of editing`) — write a new
  record with `supersedes:` instead. Git is the witness.
- **Cited records do not delete silently.** A `decision_log` row citing a record blocks its
  deletion; apply aborts atomically (the same referrer check as `inbox.user → user`).

Members never read this folder — their surface is the ambient `decisions` MCP
(`register-decision` / `search-decisions` / `get-decision`). In-flight calls land in
`decision_log`; the governance drain pass promotes what converges into this folder. See
[enforcement](../concepts/enforcement.md) for the table permissions.

---

## `ambient`

```yaml
ambient:
  skills: [journal, friction]
```

| Field    | Type       | Required | Default | Meaning |
| -------- | ---------- | -------- | ------- | ------- |
| `skills` | string[]   | no       | `[]`    | Skill names loaded in **every** workspace, regardless of purpose. No agent is attached. |

The `ambient` object itself is optional and defaults to `{ skills: [] }`. Each name must resolve —
either a catalog entry or `library/skills/<name>/SKILL.md` (invariant). Governance tooling is
**not** ambient: it is repo tooling installed by `merovingian init`, not a graph skill (ADR 0010).

---

## `marketplaces`

```yaml
marketplaces:
  guild:
    claude:                                    # Claude marketplace binding
      source: acme-labs/guild
      name: guild
    codex:                                     # Codex marketplace binding
      source: acme-labs/guild
      name: guild
  legacy:
    claude: acme-labs/claude-only              # a harness may be intentionally absent
```

A map of logical marketplace **name → native harness bindings**. Each binding accepts either a
source string or `{ source, name }`; `name` defaults to the logical marketplace name. The legacy
string shorthand (`guild: acme-labs/guild`) binds the same source/name to both harnesses.

**Optional** — a fully self-contained tenant (everything in `library/`) declares none. Every
marketplace referenced by a plugin-variant ref must be registered and have at least one binding.
If the selected workspace needs a plugin with no binding for one harness, `build` succeeds with an
explicit degradation warning. Codex installation is a separate `merovingian plugins sync`.

---

## `agents`

```yaml
agents:
  shell:
    description: Routes work to the purpose that owns it.
```

Local agent instructions live in `library/agents/<name>.md`; the neutral catalog carries the
description needed to compile each harness's native agent format. The purpose remains the source
of the initial mapping (`agent: shell`). Legacy YAML frontmatter in the markdown is temporarily
accepted as a description fallback and emits a deprecation warning; new libraries should keep the
markdown instructions-only.

---

## `tools`

The tool registry. A map of tool **name → ToolDef**. Only tools you actually run need to be
catalogued — `purpose.tools` refs are free strings and are **not** checked against this registry
(see invariants).

```yaml
tools:
  search:                        # kind: stdio (the default) — a local command
    command: uvx
    args: [search-mcp]
    env: { SEARCH_API_KEY: "${SEARCH_API_KEY}" }
    keySource: company
  docs:
    command: uvx
    args: [docs-mcp]
    env: {}
    keySource: none
  tracker:                       # remote MCP endpoint — url only
    kind: sse
    url: https://mcp.example.dev/sse
```

| Field       | Type                    | Required | Default   | Meaning |
| ----------- | ----------------------- | -------- | --------- | ------- |
| `kind`      | `"stdio"` \| `"http"` \| `"sse"` | no | `"stdio"` | Mirrors the `.mcp.json` server types 1:1. `stdio` = a local command; `http`/`sse` = a remote MCP endpoint (emitted as `{type, url}` — member auth is Claude Code's per-user OAuth, no secret in the graph). |
| `command`   | string                  | stdio: yes | —       | The executable that starts the MCP server (e.g. `uvx`, `npx`, `uv`). Forbidden on `http`/`sse`. |
| `args`      | string[]                | no       | `[]`      | Arguments passed to `command` (stdio only). Order is significant (diffs as a sequence). |
| `env`       | map `string → string`   | no       | `{}`      | Env for the server (stdio only). `${VAR}` refs are v1-style placeholders. |
| `keySource` | `"company"` \| `"none"` | no       | `"none"`  | `company` = a shared key resolved server-side into `settings.local.json` env; `none` = no secret. Stdio only. |
| `url`       | string                  | http/sse: yes | —    | The remote MCP endpoint. The only field a remote tool takes. |

A capability with no endpoint and no command (e.g. a claude.ai-exclusive integration) stays
**out of the registry** until one exists — the gap is curation, not modeling. Uncatalogued
`purpose.tools` refs ship as `echo` stub placeholders and the build prints a warning per stub.

---

## `skills` — local by default

The catalog holds **external refs only** — always the explicit `plugin@marketplace` form (a zod
regex refinement rejects anything else, with the message: `catalog refs are explicit
"plugin@marketplace"; local content resolves from library/ by convention — drop the entry`).

```yaml
skills:
  audit: compliance@guild     # external: the "compliance" plugin from the "guild" marketplace
# journal, friction, route, write, edit: NO entry — they resolve from library/skills/<name>/
```

| Field (map value) | Type   | Required | Meaning |
| ----------------- | ------ | -------- | ------- |
| `<value>`         | string | yes      | Explicit `plugin@marketplace`. The marketplace must be registered (invariant). |

Any referenced skill name **not** in this catalog resolves by convention to
`library/skills/<name>/SKILL.md` (plus any supporting files in that folder). A name that is in
neither place fails validation. The catalog is keyed per skill, so several skills can resolve to
the same plugin and skills can live across marketplaces.

---

## `purposes`

The purpose tree: an array of nodes. Exactly the shape of `Purpose` minus the lifted-out `agent`
(the loader moves `agent` into an internal `agentByPurpose` map).

```yaml
purposes:
  - id: acme
    parent: null
    reason: "shell — everyone lands here; routes to the purposes"
    agent: core            # no "@" → library agent (library/agents/core.md)
    decides: []
    owns: []
    reads: []
    skills: [route]
    tools: []

  - id: sales
    parent: growth
    reason: "convert relationships into deals"
    agent: sales-advisor@guild   # "@" → external plugin from the "guild" marketplace
    decides: [pricing]
    owns: [proposals]
    reads: []
    skills: []
    tools: []
```

| Field     | Type            | Required | Default | Meaning |
| --------- | --------------- | -------- | ------- | ------- |
| `id`      | string          | yes      | —       | Unique purpose id. Duplicates fail validation. |
| `parent`  | string \| null  | no       | `null`  | Parent purpose id. `null` = root. Must reference an existing purpose (invariant). |
| `reason`  | string          | yes      | —       | The reason the purpose exists (its "why"). |
| `agent`   | string          | no       | —       | The purpose's persona. **`@` is the discriminator**: `name` = a library agent (`library/agents/<name>.md` must exist); `plugin@marketplace` = an external plugin (marketplace must be registered). Lifted into `agentByPurpose`. A visible purpose loads its agent even with zero skills. |
| `decides` | string[]        | no       | `[]`    | **Decision domains** this purpose owns (ADR 0013). Safe slugs (letters, digits, `_`, `-`); a domain belongs to exactly **one** purpose (invariant). Owning a domain gates the in-flight decision log (read/append ride the owner's lineage) and anchors the `decisions/<domain>/` records. |
| `owns`    | string[]        | no       | `[]`    | Bucket ids this purpose may **modify**. Each must be an existing bucket (invariant). |
| `reads`   | string[]        | no       | `[]`    | Bucket ids this purpose may **consume**. Each must be an existing bucket (invariant). |
| `skills`  | string[]        | no       | `[]`    | Skill names loaded for this purpose. Each must resolve — catalog or library (invariant). |
| `tools`   | string[]        | no       | `[]`    | Tool refs enabled for this purpose. Free strings — **intentionally NOT validated** against the `tools` registry. |

> `parent: null` must be written explicitly `null` or omitted (defaults to `null`). The lineage
> `[self, parent, …, root]` is computed at deploy time, not authored.

---

## `buckets`

Units of knowledge. Each bucket has a single owner and a single sensitivity. The backend decides
where it lives.

```yaml
buckets:
  - { id: kb-company, backend: okf-repo, repo: acme-labs/kb-company, owner: growth, sens: low }
  - { id: clients, backend: surreal, tables: [client, contact], owner: success, rowScope: account, sens: high }
  - { id: proposals, backend: surreal, tables: [proposal], owner: sales, sens: high }
```

| Field      | Type                                        | Required | Default | Meaning |
| ---------- | ------------------------------------------- | -------- | ------- | ------- |
| `id`       | string                                      | yes      | —       | Unique bucket id. Duplicates fail validation. `surreal`: must be a safe slug (letters, digits, `_`, `-`) — it is interpolated (`⟨⟩`-escaped) into the generated DDL (invariant). |
| `backend`  | `"okf-repo"` \| `"surreal"` \| `"platform"` | yes      | —       | Where the knowledge lives: a git repo (prose), Surreal tables (structured/sensitive), or the platform. |
| `repo`     | string                                      | no       | —       | `okf-repo`: the git repo (`owner/name`) under the central store. |
| `tables`   | string[]                                    | no       | —       | `surreal`: the tables this bucket maps to — **provisioned** at apply time (see below). Must be safe identifiers, not engine-reserved, and belong to at most one bucket (invariants). (Defaults to `[]` in the emitted record when absent.) |
| `owner`    | string                                      | yes      | —       | The purpose accountable for this bucket. Must be an existing purpose (invariant). |
| `rowScope` | string                                      | no       | —       | `surreal`: the **field** rows are scoped by (e.g. `account`). Must be a safe identifier (invariant). Absent = unscoped (whole bucket). See below. |
| `sens`     | `"low"` \| `"medium"` \| `"high"`           | yes      | —       | Sensitivity. Drives which permissions the backend enforces. |

**Surreal buckets provision.** Declaring a `backend: surreal` bucket is enough — every
`deploy apply` (and dev `reset`) runs the **domain-schema generator** (`domainSchema`, `src/graph/domain.ts`, ADR
0011): each table gets `DEFINE TABLE OVERWRITE <table> SCHEMALESS` with `FOR select` PERMISSIONS
derived from the bucket (scoped path via `rowScope`, unscoped path via the owner's lineage) and
`FOR create, update, delete NONE` (writes are root-only today). Idempotent, regenerated on every
apply; **never drops** — removing a bucket leaves its tables and data in place (the plan prints a
note). See [enforcement](../concepts/enforcement.md) for the generated shape.

**`rowScope` semantics.** It names the row-scoping *field* generically. When a row-scoped bucket is
reached only through *scoped* assignments, the projection stamps the mount with
`"<rowScope>:<value>"` — e.g. `rowScope: account` + assignment `scope: north` → `account:north`.
The stamp is **generation-side only**: enforcement is the backend's record-level PERMISSIONS (see
[enforcement](../concepts/enforcement.md)), which the generator now derives from `rowScope` itself
(the field is defined `option<string>` — a row without it matches no scope, fail-closed).

> `repo`, `tables`, and `rowScope` are per-backend and structurally optional; the schema does
> **not** enforce "`repo` requires `okf-repo`" or "`tables` requires `surreal`" — that is
> convention, not a validated invariant. (`BucketSchema` in `load-graph.ts` is a flat object;
> the surreal-bucket checks in `validateGraph` apply only when `backend: surreal`.)

---

## `users`

People and their assignments (the "responsible" edges).

```yaml
users:
  - id: ada
    name: Ada
    github: ada-gh
    assignments:
      - { purpose: acme, role: owner }
      - { purpose: content, role: owner }
  - id: cleo
    name: Cleo
    github: cleo-gh
    assignments:
      - { purpose: delivery, scope: north, role: member }
```

| Field         | Type                | Required | Default | Meaning |
| ------------- | ------------------- | -------- | ------- | ------- |
| `id`          | string              | yes      | —       | Unique user id. |
| `name`        | string              | yes      | —       | Display name. |
| `github`      | string              | no       | —       | GitHub login — the identity anchor (v1). |
| `assignments` | array of Assignment | no       | `[]`    | Every purpose this person belongs to. Access = the union of their purposes' subtrees. |

### Assignment

| Field     | Type                    | Required | Default    | Meaning |
| --------- | ----------------------- | -------- | ---------- | ------- |
| `purpose` | string                  | yes      | —          | The purpose the person belongs to. Must be an existing purpose (invariant). |
| `scope`   | string                  | no       | —          | The instance the purpose is held over, e.g. `north`. Access-narrowing; pairs with a bucket's `rowScope` to form the row stamp. |
| `role`    | `"owner"` \| `"member"` | no       | `"member"` | `owner` = accountable (governs/deploys/decides); `member` = works there. **Access is identical for both** — the role only gates accountability. |

> An owner is accountable for the **whole** purpose, so an `owner` edge **cannot** carry a `scope`
> (invariant). To own a slice, model that slice as a sub-purpose.

---

## Reference resolution (summary)

Contract v2 has no shorthand-with-default; every ref is either explicit-external or
local-by-convention:

| You write                            | Resolves to |
| ------------------------------------ | ----------- |
| `skills: { audit: compliance@guild }` (catalog) | external `{ source: "plugin", plugin: "compliance", marketplace: "guild" }` |
| a referenced skill name with **no** catalog entry | library `{ source: "library", files }` from `library/skills/<name>/` |
| `agent: shell` (no `@`)              | library agent — content from `library/agents/shell.md` |
| `agent: sales-advisor@guild`         | external plugin `{ plugin: "sales-advisor", marketplace: "guild" }` |
| `ambient.skills: [...]`              | the config singleton's ambient skill set (each name resolves as above) |
| `parent:` omitted                    | `parent: null` (root) |

---

## A hybrid example, annotated

The bundled fixture ([`fixtures/example/graph.yaml`](../../fixtures/example/graph.yaml) +
[`fixtures/example/library/`](../../fixtures/example/library/)) demonstrates both channels of the
hybrid model (ADR 0012) — local library content plus one external skill and one external agent:

```yaml
namespace: acme

ambient:
  skills: [journal, friction]        # both from library/skills/<name>/

marketplaces:                        # EXTERNAL channels only (optional)
  guild:
    claude: acme-labs/guild
    codex: acme-labs/guild

agents:
  core:
    description: The root shell that routes work to the right purpose.

skills:
  audit: compliance@guild            # the ONLY catalog entry — everything else is library

purposes:
  - id: acme
    parent: null
    reason: "shell — everyone lands here; routes to the purposes"
    agent: core                      # library/agents/core.md
    skills: [route]                  # library/skills/route/SKILL.md

  - id: sales
    parent: growth
    reason: "convert relationships into deals"
    agent: sales-advisor@guild       # external plugin (the "@" discriminator)
    decides: [pricing]
    owns: [proposals]

  - id: infra
    parent: acme
    reason: "operate the tenant — workspace, db, governance"
    agent: infra                     # library/agents/infra.md
    skills: [audit]                  # → compliance@guild via the catalog

buckets:
  - { id: clients, backend: surreal, tables: [client, contact], owner: success, rowScope: account, sens: high }
```

---

## Validation invariants

`validateGraph` runs on every `deploy plan` and returns human-readable errors. A graph is valid only
when all of these hold:

| Invariant | Error when violated |
| --------- | ------------------- |
| Purpose ids are unique | `duplicate purpose: "<id>"` |
| Bucket ids are unique | `duplicate bucket: "<id>"` |
| `purpose.parent` (when non-null) references an existing purpose | `purpose "<id>": parent "<p>" does not exist` |
| Every `purpose.owns` bucket exists | `purpose "<id>": owns bucket "<b>" does not exist` |
| Every `purpose.reads` bucket exists | `purpose "<id>": reads bucket "<b>" does not exist` |
| Every `purpose.skills` name resolves (catalog or library) | `purpose "<id>": skill "<s>" not in catalog and no library/skills/<s>/SKILL.md` |
| Every `ambient.skills` name resolves (catalog or library) | `ambient: skill "<s>" not in catalog and no library/skills/<s>/SKILL.md` |
| Every `bucket.owner` references an existing purpose | `bucket "<id>": owner "<o>" does not exist` |
| A `surreal` bucket's id is a safe slug (`^[A-Za-z0-9_-]{1,64}$`) | `bucket "<id>": id is not a safe slug (letters, digits, _ or -)` |
| A `surreal` bucket's `rowScope` is a safe identifier (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`) | `bucket "<id>": rowScope "<r>" is not a safe identifier (letters, digits, _)` |
| Every `surreal` bucket table is a safe identifier (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`) | `bucket "<id>": table "<t>" is not a safe identifier (letters, digits, _)` |
| No `surreal` bucket table is an engine table (`config`, `purpose`, `bucket`, `tool`, `marketplace`, `skill`, `agent`, `user`, `responsible`, `inbox`, `decision`, `decision_log`, `decision_domain`) | `bucket "<id>": table "<t>" is reserved (engine table)` |
| A table belongs to at most one bucket | `table "<t>" is declared by two buckets ("<a>" and "<b>") — one table, one bucket` |
| Every `decides` entry is a safe slug (`^[A-Za-z0-9_-]{1,64}$`) | `purpose "<id>": decision domain "<d>" is not a safe slug (letters, digits, _ or -)` |
| A decision domain belongs to at most one purpose | `decision domain "<d>" is declared by two purposes ("<a>" and "<b>") — one domain, one purpose` |
| Every `decisions/` record's slug is a safe slug | `decision "<id>": slug is not safe (letters, digits, _ or -)` |
| Every `decisions/` record's folder (domain) is declared by some purpose | `decision "<id>": domain "<d>" is not declared by any purpose (decides:)` |
| Every record's `supersedes` resolves to an existing record | `decision "<id>": supersedes "<s>" does not exist` |
| Every **plugin-variant** catalog skill's marketplace is registered | `skill "<name>": marketplace "<m>" not registered` |
| Every inline agent's purpose exists | `agent of "<pid>": purpose does not exist` |
| Every **plugin-variant** agent's marketplace is registered | `agent of "<pid>": marketplace "<m>" not registered` |
| Every **library-variant** agent's file exists | `agent of "<pid>": no library/agents/<name>.md` |
| Every assignment's purpose exists | `user "<id>": assigned to nonexistent purpose "<p>"` |
| An `owner` assignment has no `scope` (ADR 0008) | `user "<id>": owner of "<p>" with scope "<s>" (an owner has no scope — create a sub-purpose, ADR 0008)` |

The marketplace checks apply **only** to plugin-variant refs — a fully-local graph needs no
`marketplaces:` at all.

**Explicitly NOT validated:** `purpose.tools` is **not** checked against the `tools` registry. Tool
refs are free strings — the catalog is a partial "tools we actually run" registry, so validating
them would produce false failures.
