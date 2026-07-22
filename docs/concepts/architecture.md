# Architecture — how it actually works

Merovingian is a pipeline of pure transforms with the IO pushed to the edges. Two seams — the
`Manifest` and the `DefinitionProvider` — let the same core survive a swap of backend
(`Stub → Surreal`) or of location (`Local → Remote`).

## The build data flow

```
graph.yaml + library/  ──load──▶  Definition  ──resolve(user)──▶  Manifest  ──emit(dir)──▶  workspace files
 (tenant repo)                (in-memory model)    │ pure               │ pure               CLAUDE.md
                                                   │                    │                    .mcp.json
                              DefinitionProvider ──┘                    │                    settings.local.json
                              (Stub | Surreal)                          │                    .claude/skills+agents
                                                                        │                    .merovingian/build.json
                                                                        └── the tested seam
```

- **`Definition`** (`src/provider/types.ts`) — the whole tenant model for one namespace: purposes,
  buckets, tool catalog, skill catalog (external plugin refs *and* folded-in library content,
  ADR 0012), agent-by-purpose, marketplaces, ambient.
- **`resolve(def, user, opts) → Manifest`** (`src/projection/resolve.ts`) — **pure, no IO**. Projects
  the global definition onto one identity: visible purposes, buckets, tools, plugins, library
  skills/agents (content included), scope stamps. Because it's pure it is trivially golden-testable
  and indifferent to where the `Definition` came from.
- **`emit(manifest, dir, access?) → files`** (`src/projection/emit.ts`) — materializes the `Manifest`
  into the workspace folder (atomic writes), including the library slice into `.claude/skills/` and
  `.claude/agents/` (both wiped and rebuilt each build). The only IO in the projection path.

## The provider abstraction

`DefinitionProvider` (`src/provider/types.ts`) is the one interface the rest of the engine reads the
graph through:

```
interface DefinitionProvider {
  getDefinition(): Promise<Definition>
  resolveUser(userId): Promise<User>
  listAssignments(): Promise<AssignmentRow[]>   // god-view
}
```

Two implementations, same interface:

- **`StubProvider`** (`src/provider/stub.ts`) — the offline path. Serves the synthetic `acme`
  fixture from memory (`fixtures/example/`). No database. Powers the golden tests and the explicit
  `--backend stub` opt-in.
- **`SurrealProvider`** (`src/provider/surreal.ts`) — the live path. Reads the structure back out of
  SurrealDB and reassembles the `Definition`. Same shape out.

The golden suite asserts against the `Manifest`, so the **same assertions run for stub and surreal**
(surreal skips if the DB is down). Green on both proves the stub isn't throwaway and that the
projection survives the provider swap.

## The BuildService boundary

`BuildService` (`src/service/build-service.ts`) is where "read the whole graph and resolve a scoped
manifest" lives. In production it runs **server-side**: it holds the backend credentials, sees the
whole graph, runs `resolve`, and hands back a scoped `Manifest` (+ a scoped token). The CLI consumes
the `Manifest` only — it never holds a provider or DB creds directly.

```
interface BuildService { getManifest(userId, opts?): Promise<Manifest> }
```

Three implementations behind that one method:

- **`LocalBuildService(stub)`** — fixture in memory (offline, golden tests).
- **`LocalBuildService(surreal)`** — reads the graph from Surreal in-process.
- **`RemoteBuildService`** — calls the HTTP build/auth service (`GET /manifest`), gh-authenticated;
  secrets stay server-side. Identity comes from the gh token, not a `userId`. okf paths are patched
  client-side (the service doesn't know your filesystem).

`getManifest()` is the seam: swapping `Stub → Surreal` or `Local → Remote` **never moves it**. The
company-key env refs (`resolveToolEnv`) resolve against *the environment the service runs in* — so
in Remote mode secrets are resolved server-side and only the resolved values travel.

## The Manifest as the tested seam

The `Manifest` (`src/projection/resolve.ts`) is a plain value: namespace, user, assignments, visible
purposes, okf mounts, surreal mounts, tools/toolMounts, plugins, marketplaces,
librarySkills/libraryAgents (content included), skills. Everything
upstream (load, provider, resolve) produces it; everything downstream (emit, the files) consumes it.
That is why it is the assertion target: it isolates the projection logic from both the source
(stub/surreal) and the sink (filesystem).

```
   ┌── source-agnostic ──┐        ┌── sink-agnostic ──┐
   provider → Definition → resolve → Manifest → emit → files
                                     ▲
                            golden tests assert HERE
```

## Where the deploy path sits

Deploy is the mirror pipeline, also pure at its core:

- `src/graph/plan.ts` — `validateGraph` + `planGraph` (both pure: no DB, no network).
- `src/graph/apply.ts` — `applyGraph` orchestrates the IO (schema, upsert, reconcile, delete).
- `src/graph/records.ts` — `Definition` → structural SurrealDB records.

See [build-vs-deploy.md](./build-vs-deploy.md) for the deploy semantics and
[enforcement.md](./enforcement.md) for what the emitted workspace is allowed to do at runtime.

## Module map

```
graph/       load-graph (yaml + library/ → Definition) · plan (validate + diff) · apply (converge) · records · domain (generated DDL)
provider/    DefinitionProvider — StubProvider (fixture) | SurrealProvider (live)
projection/  resolve (Definition + user → Manifest, pure) · emit (Manifest → files)
service/     BuildService boundary: getManifest(identity) → scoped Manifest (Local | Remote/HTTP)
commands/    init · reset · deploy · library · login · graph · build · data · inbox · decisions · namespace
init/        tenant scaffolding: baseline graph/settings + the library templates init seeds
server/      console (read-only god-view) · service (gh-auth, holds root + signing key)
mcp/         surreal-data · inbox · decisions — stdio MCPs (run via `merovingian mcp <name>`); fresh scoped token per call
surreal/     schema.surql (structure) · data.surql (engine runtime: JWT access + inbox + the decision tables)
```
