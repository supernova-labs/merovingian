# Overview — the mental model

Merovingian models an organization as a **graph of purposes** and treats that graph like
infrastructure. One declarative source, two operations, one enforced backend.

## Source vs tenant

- **The Source** is this engine: the TypeScript + Bun code that reads a graph, projects
  workspaces, and reconciles a database. It is tenant-agnostic.
- **A tenant** is one organization's `graph.yaml` (its purposes, buckets, people, tool/skill
  catalog) plus its `library/` (first-party skill and agent prompts, [ADR
  0012](../decisions/consolidadas/0012-library-do-tenant-e-distribuicao-hibrida.md)) plus the
  SurrealDB database that structure lives in. The tenant is *data*; the Source is *code*. This repo
  carries a synthetic tenant, `acme`, under `fixtures/example/` — for tests and the offline stub
  only.

The graph model itself (purposes, buckets, assignments, the 5 primitives) is described in
[the-graph.md](./the-graph.md). This page is the map; that page is the territory.

## Two operations, one graph

```
                 graph.yaml  (desired state — the tenant's declared graph)
                     │
        ┌────────────┴─────────────┐
        │                          │
     build                      deploy
   (projection)             (reconciliation)
        │                          │
   a scoped workspace          SurrealDB structure
   for ONE person              converged to the graph
   (files on disk)             (idempotent, structure-only)
```

- **`build`** — *projection*. Given a person, project the workspace they are entitled to: the
  purposes they can see (their assigned purposes + descendants), the knowledge buckets they may
  read/own, the skills/tools/agent that load — external plugins *and* their slice of the tenant
  library, materialized into native Claude Code and Codex layouts — and the row-level scope on
  sensitive data. Output is a folder containing `CLAUDE.md` + `.claude/**` and
  `AGENTS.md` + `.agents/**` + `.codex/**`, plus MCP/config files and a build stamp. See
  [build-vs-deploy.md](./build-vs-deploy.md).
- **`deploy`** — *reconciliation*. The graph **and the library content** are desired state;
  `deploy plan` diffs them against the live SurrealDB (read-only; content as short hashes),
  `deploy apply` converges — **structure-only, idempotent, referrer-safe on delete**. Never touches
  business data. Same page.

## Generation ≠ enforcement

The build *generates* a scoped workspace; it does not *enforce* anything. Enforcement is the
backend's job: sensitive rows carry record-level SurrealDB `PERMISSIONS` keyed on a scoped JWT
identity. A workspace's scope is only real because the database honors it — see
[enforcement.md](./enforcement.md).

## The lifecycle at a glance

1. **Author** the graph — edit `graph.yaml` and/or `library/` in the tenant repo (`init` scaffolds
   both, seeding the library from the Source templates).
2. **Deploy** — `deploy plan` audits drift, `deploy apply` converges SurrealDB structure (a virgin
   db included — the first run is just apply). `reset` is the blunt dev/test wipe (structural
   tables + reproject); never on a live tenant.
3. **Build** — each person runs `merovingian build <namespace>` in their workspace folder; the
   build service resolves their scoped `Manifest` and emits the files.
4. **Work** — inside the workspace, the bundled MCPs (`surreal-data`, `inbox`) reach the tenant DB.
   Each call fetches a fresh scoped token; SurrealDB's `PERMISSIONS` decide what is returned.
5. **Reconcile** — the graph or the library content changes, `deploy` re-converges, people
   re-`build`. The loop repeats.

## Where to go next

- [the-graph.md](./the-graph.md) — the graph model (purposes, buckets, assignments).
- [build-vs-deploy.md](./build-vs-deploy.md) — projection vs reconciliation in detail.
- [architecture.md](./architecture.md) — the data flow and the internal seams.
- [enforcement.md](./enforcement.md) — how the database honors a scope.
- [topology.md](./topology.md) — the runtime pieces and what each one trusts.

Conceptual foundations (the 5 primitives, the 5 principles) live in
[`../foundation/`](../foundation/) (Portuguese). Design rationale lives in the ADRs under
[`../decisions/`](../decisions/).
