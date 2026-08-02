# build vs deploy — projection vs reconciliation

Two operations act on the one graph. They point in opposite directions and touch different things.

```
   build   :  global definition  ──project──▶  scoped workspace (files)   [per person]
   deploy  :  graph.yaml + library (desired) ─converge─▶  SurrealDB structure [per tenant]
```

Neither one crosses into the other's territory. `build` never writes the database; `deploy` never
touches business data.

---

## build — projection

`build` answers a single question: *given this person, what workspace are they entitled to?* It is
a **pure projection of the global definition onto a scoped target** (purpose × scope × human).

**Reads**

- The whole definition (purposes, buckets, tool/skill catalog, marketplaces) — via a
  `DefinitionProvider`.
- The person's assignments (which purposes, which role, which scope).

**Computes** (`src/projection/resolve.ts`, a pure function → `Manifest`)

- **visible purposes** = each assigned purpose + its transitive descendants. The projection starts
  from the *assumed* purpose and never expands upward into privilege above it.
- **buckets** = union of `owns ∪ reads` across visible purposes.
- **okf-repo buckets** → `additionalDirectories` (a path in the central repo store).
- **surreal buckets** → a data mount; a row-scoped bucket (`rowScope` set) reached only by *scoped*
  assignments is stamped `"<rowScope>:<value>"` (e.g. `account:north`; an unscoped granting path
  wins — broader access). This stamp is **generation, not enforcement** (see
  [enforcement.md](./enforcement.md)).
- **skills & agents** = each needed skill (visible + ambient) and each visible purpose's agent
  resolves through the catalog to *either* an external `plugin@marketplace` (→ `enabledPlugins`)
  *or* tenant-library content, carried in the manifest as `librarySkills`/`libraryAgents` **with
  the file content included** (ADR 0012).
- **tenant instructions** = the normalized `library/workspace.md` fragment, carried unchanged in
  every identity's Manifest, including builds narrowed with `--purposes` (ADR 0018).
- **tools** = union of tools across visible purposes, resolved against the tool registry.

`--purposes a,b` can *narrow* a build to a subset (each expanded to descendants), bounded by
entitlement — it can only ever subtract, never grant.

**Writes** (`src/projection/emit.ts`, one Manifest → both native harness layouts)

- `CLAUDE.md` — the human/agent-readable index, including tenant-wide operating instructions.
- `.mcp.json` — the MCP servers, by name (tools + the system `inbox`/`surreal-data` MCPs).
- `.claude/settings.local.json` — marketplaces, enabled plugins, `additionalDirectories`, env.
  (`settings.local.json`, not `settings.json`: generated, disposable, git-ignored by convention.)
- `.claude/skills/<name>/*` + `.claude/agents/<name>.md` — the person's slice of the tenant
  library for Claude Code.
- `AGENTS.md` (with the same tenant-wide instructions) + `.codex/config.toml` + `.agents/skills/<name>/*` +
  `.codex/agents/<name>.toml` — the equivalent Codex projection.
- `.merovingian/build.json` — per-emitter inventory and explicit degradation records. Stale
  generated files are removed without deleting unowned siblings.

Role does **not** change the workspace: owner and member of the same purpose get the same files.
Role only gates accountability (governance/deploy/decide), not access.

**Does NOT**

- Touch SurrealDB structure or business data.
- Embed a long-lived Merovingian credential. System MCP config carries a *token source* (how to
  fetch a fresh scoped JWT per call), never a baked-in token. Company-key MCP values are local,
  mode-0600 config only, and make builds inside Git repositories fail closed.

---

## deploy — reconciliation

`deploy` treats `graph.yaml` **plus the tenant library** as desired state and converges the
database toward it, the way a declarative infra tool converges cloud resources. Library content is
not a side-channel: skill files persist into `skill` records (`{ source: "library", files }`) and
agent prompts into the `agent` table, while `library/workspace.md` persists into the tenant-wide
`config.instructions` field. `build` can therefore materialize a person's slice and common root
instructions without ever reading the tenant repo (ADRs 0012/0018).

### `deploy plan` — audit (read-only)

`src/commands/deploy.ts` → `deployPlan`:

1. **validate** the desired graph (`validateGraph`, pure): referential integrity (parents, bucket
   owns/reads, catalog membership) + the owner⇒unscoped invariant. Authoring bugs caught before any
   write. `purpose.tools` is intentionally *not* validated against the catalog (tool refs are free
   strings; the catalog is a partial "tools we actually run" registry).
2. **diff** desired vs current (`planGraph`, pure): field-level, per resource kind. Set-valued
   arrays diff order-blind; command args diff as an ordered sequence. **Content diffs as hashes**:
   library skill files diff as a file-name set plus a per-changed-file sha256-8 scalar (e.g.
   `files.SKILL.md: 6ecffe0c → e0bd1151`), and library agent content as a single `content` hash
   scalar. Tenant-wide instructions also diff as one `config.instructions` sha256-8 scalar — never
   full text. The plan only proves drift; the reviewable full diff is the
   tenant-repo PR.
3. **external check**: does each referenced GitHub repo (kb / marketplace) exist? (manual
   checklist, best-effort).

Exit codes: `2` invalid · `1` drift · `0` in sync. Nothing is written.

### `deploy apply` — converge

`src/graph/apply.ts` → `applyGraph(reset: false)`:

```
validate → ensure schema → read current → plan → [--yes gate on any deletion]
  → [pre-flight referrer-check, atomic] → upsert desired → reconcile edges → delete removed
```

- **structure-only**: touches the structural tables (`config`, `purpose`, `bucket`, `tool`,
  `marketplace`, `skill`, `agent`, `user`, `responsible`). Never runtime/business tables
  (`client`, `inbox`, …).
- **idempotent**: desired records are upserted (create-or-replace, full-content — so a removed
  optional field like a dropped agent becomes `NONE`); a clean graph re-applies to zero changes.
- **referrer-safe on delete**: before deleting a record, a pre-flight check queries the live
  runtime rows that still point at it (e.g. `inbox.user → user`). If any delete is blocked, apply
  **aborts before writing anything** — atomic-on-block, no partial state. Structural referrers are
  provably clean (validation + upsert-before-delete), so only live runtime rows can block.
- **`--yes`-gated**: any deletion (record or edge) requires confirmation; without `--yes`, apply
  returns `needs-confirm` and writes nothing.

Atomicity is achieved without a DB transaction: apply never touches runtime tables, so a runtime
referrer reads identically before and after the upsert, and validation guarantees no surviving
structural record references a deleted one — making the pre-write referrer check accurate.

### `reset` — the dev/test wipe

`src/commands/reset.ts` → `applyGraph(reset: true)`: a blunt **wipe structural tables + project**,
no plan, no referrer-check, no gates. Dev/test only — never a live tenant. `deploy apply` is the
only reconciliation verb (it bootstraps a virgin db by itself, so even the first run needs no
`reset`). Both share one `applyGraph` orchestration.

**deploy does NOT**

- Touch business data (`client`, `inbox`).
- Generate any workspace files.
- Bypass the deletion gates in `apply` mode (only `reset` wipes without confirmation).

---

## The invariant

The tested boundary between them is the **`Manifest`** (build) and the **plan** (deploy) — both pure
values, both source-agnostic. See [architecture.md](./architecture.md).
