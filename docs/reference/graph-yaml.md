# Graph YAML reference

The parser accepts strict objects: unknown keys are errors. Local library/decision directories
are not read. See `fixtures/example/graph.yaml` for a complete synthetic example.

| Top-level field | Shape and purpose |
|---|---|
| namespace | Required tenant/database name |
| ambient | Optional skills list and instructions Markdown; defaults to empty skills |
| marketplaces | Name → shared source string or per-client claude/codex bindings |
| skills | Name → explicit plugin@marketplace string |
| tools | Name → validated stdio/http/sse tool declaration; public catalog exposes requirements, not configuration secrets |
| purposes | Required list of purpose records |
| buckets | Resource list, default empty |
| users | Individual profile and assignment list, default empty |
| github | Optional administrative repository policy; see GitHub reference |

## Plugins and instructions

```yaml
namespace: acme
ambient:
  skills: [journal]
  instructions: Respect authenticated access and keep material changes reviewable.
marketplaces:
  core:
    claude: acme-labs/core-claude
    codex: {source: acme-labs/core-codex, name: acme-core}
skills:
  journal: core@core
purposes:
  - id: acme
    reason: Coordinate the tenant
    agent: core@core
users:
  - id: ada
    name: Ada
    github: ada-example
    journalAdmin: true
    assignments: [{purpose: acme, role: owner}]
```

This is a schema example; repositories are illustrative. A plain marketplace source string
binds both clients under its logical name. An object can omit a client, producing an unsupported
binding in that client's catalog. All skill references must resolve; purpose agents use the
same plugin@marketplace syntax. Top-level agents metadata and bare local agent names are rejected.

## Records

Purpose: required `id`, `reason`; optional `parent` (null by default), `agent`, and lists
`decides`, `owns`, `reads`, `skills`, `tools` (empty by default). `decides` is descriptive
metadata; it no longer creates a decision log. Names remain validated for uniqueness and safety.

Bucket: required `id`, `backend` (okf-repo/surreal/platform), `owner`, `sens` (low/medium/high).
Optional `repo`, `tables`, `rowScope` must be consistent with the backend and graph references.
An okf-repo identifies a GitHub repository. Surreal domains declare table names; rowScope names
the field used for scoped reads. Removing a bucket never drops business tables.

User: required `id`, `name`; optional `github`, valid `email`, nonempty `slackId`, `journalAdmin`,
and `assignments`. Each assignment has required `purpose`, optional `scope`, and `role`
(owner/member, default member). Owner assignments cannot be scoped. Profile identifiers and
journalAdmin are maintained by administrators, not by personal MCP calls.

Tool: kind stdio by default, with required command, optional args/env, keySource company/none
(default none). HTTP/SSE require url and reject command/args/env/company-key configuration.
These retained declarations do not cause setup to distribute credentials or emit tool configs.

Validation covers parent cycles/references, ownership, assignments, skill/marketplace references
and resource safety. GitHub policy additionally verifies identity uniqueness, effective access
and review-team composition against the remote provider. See [GitHub deployment](github-deploy.md).
