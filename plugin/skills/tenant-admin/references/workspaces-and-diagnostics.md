# Workspaces and diagnostics

Use this reference to project a member workspace, keep both harnesses current, and diagnose common
failures without weakening access boundaries.

## Build in the correct folder

`build` writes into the current directory. Use a separate folder owned by the member, never the
tenant repo or Source checkout:

```bash
mkdir -p ~/workspaces/<user>-<namespace>
cd ~/workspaces/<user>-<namespace>
merovingian login <namespace> <user>   # omit <user> for a registered remote service
merovingian graph <namespace>
merovingian build <namespace>
```

Use `--purposes a,b` only to narrow to accessible purposes. It cannot expand entitlement. Confirm
the personal graph first when the expected purpose is missing.

## What build owns

One manifest produces both harness projections:

- Claude: `CLAUDE.md`, `.mcp.json`, `.claude/settings.local.json`, `.claude/skills/`, and
  `.claude/agents/`.
- Codex: `AGENTS.md`, `.codex/config.toml`, `.agents/skills/`, and `.codex/agents/`.
- Shared workspace state: `.merovingian/build.json` and `context/<bucket>` mounts.

Generated files are disposable and must not be hand-edited. Build removes only stale paths listed
in its previous per-emitter inventory, preserves unrelated siblings, and refuses to overwrite
foreign root/config files. If ownership is refused, move or deliberately reconcile the foreign
file; do not force an overwrite.

Tenant-owned behavior is edited in the tenant repo and propagated through deploy + rebuild:

- `library/skills/` and `library/agents/` reach only identities whose projection references them.
- `library/workspace.md` reaches every member, appears in both root instruction files, and never
  overrides identity, scope, access, or ratified decisions.
- `library update` refreshes Source-owned templates but never manages `library/workspace.md`.

## Harness completion

Claude marketplace approval for the governance plugin is a repo-level setup step. Codex plugin
requirements projected from the graph are reconciled separately:

```bash
merovingian plugins sync
```

Build may succeed with an explicit Codex degradation warning when a plugin is missing. Sync after
reviewing the requested marketplace/plugin sources. On first use, trust the exact workspace in
Codex; until that user gate is accepted, project-local MCP and permission config remains inactive.

## When to rebuild

Rebuild a member's workspace after changes to their visible purposes, assignments, buckets, tools,
skills, agents, decisions, plugin bindings, or mounts. Rebuild every workspace after a
`library/workspace.md` change. Deploy does not push files to machines, and build does not deploy
desired state to Surreal.

A useful stale-workspace check is:

1. Tenant repo has a clean `deploy plan`.
2. Member `graph` shows the expected entitlement.
3. Member reruns `build` in the intended workspace.
4. Build emits no unresolved degradation or mount warning.
5. Sensitive data is verified with `data`, not inferred from generated files.

## Diagnostic map

| Symptom | Check | Safe response |
|---|---|---|
| `not logged in` | Per-machine session for this namespace | Run the correct local or remote `login` flow. |
| Authentication failure | Auth mode, cwd `.env`, user id/GitHub mapping, rotated password | Correct the selected path; never substitute root credentials on a member machine. |
| Unknown namespace | Backend selection and namespace registry | Remove accidental `--backend stub`; verify `merovingian.toml`, env, or `namespace add`. |
| Purpose missing | `graph <ns>` and deployed assignments | Fix desired state through plan/apply; `--purposes` cannot add access. |
| OKF mount missing | Member's GitHub auth and repository ACL | Grant the external ACL explicitly, then rebuild. |
| Surreal table empty | Bucket declaration, assignment/scope, and backend data | Use `data`; empty can mean no rows or correctly denied rows. Do not bypass PERMISSIONS. |
| Foreign root/config file | Build ownership record and target directory | Use a clean workspace or deliberately move the unowned file. |
| Codex MCP/plugin inactive | Trust gate and build warnings | Trust the workspace, run `plugins sync`, then reopen/rebuild as needed. |
| Tenant instructions unchanged | Deploy state and member rebuild time | Apply `library/workspace.md`, then rebuild that machine. |
| Deploy returns drift/invalid/blocked | Exit code and plan detail | Review, fix desired state/referrers, and retry; do not force around the gate. |
| Console would be shared remotely | Bind and trust model | Keep it on trusted localhost; it has no authentication. |

When gathering diagnostics, redact URLs that reveal private topology and never print `.env`, tokens,
passwords, generated secret-bearing configs, or root connection variables. Report whether the
failure is desired-state drift, identity/authentication, external ACL, projection staleness, harness
setup, or backend enforcement; each has a different owner and fix.
