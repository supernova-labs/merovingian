# Merovingian — the Source

Merovingian OS: a declarative engine that projects a tenant's purpose-graph into scoped Claude Code
workspaces (`build`) and reconciles it with the database (`deploy`). See `README.md` for the model.

## Layout
- `src/` — the engine: `graph/` (load/plan/apply/records), `provider/` (Stub | Surreal),
  `projection/` (resolve → Manifest → emit), `service/`, `commands/`, `server/`, `mcp/`, `init/`.
- `bin/` — CLI entrypoints (`merovingian`, `-service`, `-console`).
- `fixtures/example/` — the synthetic `acme` tenant (tests + offline stub). **No real tenant data.**
- `surreal/` — `schema.surql` (structure) + `data.surql` (business tables + PERMISSIONS + JWT).
- `docs/decisions/` — the ADRs (design rationale) · `docs/foundation/` — the 5 primitives & principles.
- `.claude-plugin/` + `plugin/` — the governance plugin (the marketplace this repo carries).

## Working here
- `bun test` — golden suite, SAME assertions for stub AND surreal (surreal skips if the DB is down).
- `bun run typecheck` before committing. `bun run db:up` for a local SurrealDB.
- Conventional commits. Do NOT mention Claude Code in commit messages or PR descriptions.
