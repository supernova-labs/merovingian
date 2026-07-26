# Merovingian — the Source

Merovingian OS is a declarative engine that projects a tenant's purpose graph into
identity-scoped agent workspaces (`build`) and reconciles that graph with the database
(`deploy`). See `README.md` for the product model.

## Repository boundaries

- This repository is the Source engine. Real tenants live in separate repositories.
- `fixtures/example/` contains the synthetic `acme` tenant used by tests and offline
  development. Never add real tenant data, credentials, or private operational state.
- Treat graph access semantics, generated database permissions, authentication, and
  secret handling as security-sensitive. Preserve fail-closed behavior.

## Layout

- `src/graph/` — graph loading, planning, application, and records.
- `src/provider/` — provider implementations (`Stub` and `Surreal`).
- `src/projection/` — manifest resolution and workspace emission.
- `src/service/`, `src/server/`, and `src/mcp/` — runtime and integration surfaces.
- `src/commands/` and `bin/` — CLI commands and entrypoints.
- `src/init/` — project initialization.
- `surreal/` — schema, domain tables, permissions, and authentication definitions.
- `docs/decisions/` — ADRs and architectural rationale.
- `docs/foundation/` — primitives and principles.
- `.claude-plugin/` and `plugin/` — the governance plugin currently carried by this
  repository.

## Working in the checkout

- Use Bun 1.3 or newer.
- Run the development CLI with `bun bin/merovingian.ts`; a globally installed
  `merovingian` command may point to the published package instead of this checkout.
- Run `bun test` for the golden suite. The same assertions cover Stub and Surreal;
  Surreal-backed cases skip when the local database is unavailable.
- Run `bun run typecheck` before committing.
- Start the optional local SurrealDB with `bun run db:up`.
- Add or update tests when behavior changes, especially projection output, graph
  semantics, permissions, authentication, or provider reconciliation.

## Architecture and documentation

- Read the applicable ADRs before changing architecture. Start with
  `docs/decisions/INDEX.md`.
- ADRs under `docs/decisions/consolidadas/` are architectural precedent. Do not
  silently redesign a consolidated decision.
- Architectural ADRs are written in Portuguese; public product documentation is
  written in English.
- Keep shared agent guidance vendor-neutral. Harness-specific configuration belongs
  in its corresponding adapter or configuration surface.

## Git and review

- Use Conventional Commits.
- Do not add AI-assistant attribution or mention Claude Code, Codex, or another
  assistant as the author of commits or pull requests.
- Keep unrelated working-tree changes out of a commit.

## Local operator context

- `CLAUDE.local.md` may exist in Luis's checkout as ignored, private operational
  context. Read it only when a task depends on local services, real tenant state,
  publishing state, or operator-specific workflow.
- Never commit that file, reproduce sensitive values from it, or move its private
  contents into tracked files.

## Code Review Rules

- Flag any real tenant data, credentials, secrets, or private topology added to the
  public repository.
- Flag changes that weaken authentication, authorization, generated permissions, or
  tenant isolation without an explicit architectural decision and matching tests.
- Flag behavior changes that lack proportionate golden, unit, or integration coverage.
