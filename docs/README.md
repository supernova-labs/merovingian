# Merovingian documentation

Merovingian models an organization as a **graph of purposes**: `build` projects each person a scoped
Claude Code workspace, `deploy` reconciles a `graph.yaml` into SurrealDB. This is the full
documentation set. New here? Read [concepts/overview.md](./concepts/overview.md) first.

The docs are organized by what you're trying to do (a [Diátaxis](https://diataxis.fr) split):

## Concepts — understand how it works

| Doc | What it covers |
|---|---|
| [overview](./concepts/overview.md) | The 1-page mental model: Source vs tenant, the two operations, the lifecycle. |
| [the-graph](./concepts/the-graph.md) | purpose · bucket · scope · skill · tool · user + assignment · decision domains — the model. |
| [build-vs-deploy](./concepts/build-vs-deploy.md) | Projection vs reconciliation — what each reads, writes, and never touches. |
| [architecture](./concepts/architecture.md) | The data flow `graph.yaml → Definition → Manifest → workspace`; the provider & service seams. |
| [enforcement](./concepts/enforcement.md) | The security model: `generation ≠ enforcement`; scoped JWT identity + SurrealDB PERMISSIONS. |
| [topology](./concepts/topology.md) | The runtime pieces — CLI, service, MCPs, SurrealDB — what runs where and holds what. |

## Guides — get something done

| Doc | What it covers |
|---|---|
| [getting-started](./guides/getting-started.md) | First run end-to-end, locally, with the bundled `acme` example. |
| [operating-a-tenant](./guides/operating-a-tenant.md) | **The operator runbook**: connect → deploy → login → build. |
| [authoring-the-graph](./guides/authoring-the-graph.md) | The change loop (plan → apply), rename semantics, the invariants. |
| [connection-and-secrets](./guides/connection-and-secrets.md) | Point the CLI at a database, the JWT secret, how company API keys resolve. |
| [going-to-production](./guides/going-to-production.md) | From the offline stub → a real Surreal backend; the service; multi-tenant. |
| [releasing](./guides/releasing.md) | Tag-driven npm releases (trusted publishing) · the plugin's independent version line · the both-manifests rule. |

## Reference — look up an exact contract

| Doc | What it covers |
|---|---|
| [cli](./reference/cli.md) | Every command, its flags, exit codes, and authoring-vs-runtime split. |
| [graph-yaml](./reference/graph-yaml.md) | The complete `graph.yaml` schema — every key, type, default, invariant. |
| [env-vars](./reference/env-vars.md) | Every environment variable the engine reads and its default. |
| [machine-layout](./reference/machine-layout.md) | The per-machine on-disk layout: session files, the central repo store. |

## The design record — why it's built this way

These predate the product docs and are kept in Portuguese; they are the rationale, not a how-to.

- **[foundation/](./foundation/)** — the conceptual base: the 5 primitives and the 5 principles.
- **[decisions/](./decisions/)** — the ADRs. `decisions/INDEX.md` is the status of all of them.

## The queue — what is NOT done


## Suggested paths

- **Operating a tenant** → overview → getting-started → operating-a-tenant → connection-and-secrets.
- **Authoring a graph** → the-graph → authoring-the-graph → reference/graph-yaml.
- **Contributing to the engine** → architecture → build-vs-deploy → enforcement → topology.
