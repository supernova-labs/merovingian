# Merovingian documentation

These guides describe the next-major checkout: declarative deploy, authenticated
catalog, native plugins/setup, and immutable Journal. The published 0.5.x CLI differs.

## Concepts

- [Overview](concepts/overview.md) — Source, tenant and member responsibilities.
- [The graph](concepts/the-graph.md) — purposes, assignments and resource access.
- [Build to catalog/setup](concepts/build-vs-deploy.md) — the new distribution boundary.
- [Architecture](concepts/architecture.md), [enforcement](concepts/enforcement.md),
  and [topology](concepts/topology.md) — data flow, authority and runtime processes.

## Guides

- [Getting started](guides/getting-started.md) — synthetic example and first deploy.
- [Operating a tenant](guides/operating-a-tenant.md) — administrative workflow.
- [Authoring the graph](guides/authoring-the-graph.md) — review and reconciliation.
- [Onboarding a member](guides/onboarding-a-member.md) — identity, access and setup.
- [Connections and secrets](guides/connection-and-secrets.md) — private configuration.
- [Production](guides/going-to-production.md) — rollout and operational limits.
- [History and cutover](guides/history-and-cutover.md) — preserve history and retire old runtime.
- [Releasing](guides/releasing.md) — package and plugin publication gates.

## Reference and evidence

- [CLI](reference/cli.md), [graph YAML](reference/graph-yaml.md),
  [environment](reference/env-vars.md), and [machine layout](reference/machine-layout.md).
- [Catalog and Journal](reference/catalog-and-journal.md) — personal MCP contract.
- [GitHub deploy](reference/github-deploy.md) — permissions and protection policies.
- [Desktop smoke evidence](testing/desktop-mcp-smoke.md) — results and remaining acceptance.
- [Candidate review](testing/release-candidate.md) — package evidence and cutover gates.
- [Roadmap](ROADMAP.md) — release gates and deferred work.

## Architectural history

The Portuguese [ADR index](decisions/INDEX.md) identifies current and superseded
decisions. [Foundation](foundation/) records conceptual origins, not runtime commands.
ADRs 0019 and 0020 take precedence over historical build/library/queue descriptions.
