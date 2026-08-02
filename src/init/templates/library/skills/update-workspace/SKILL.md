---
name: update-workspace
description: Refresh the Merovingian CLI, rebuild the current generated workspace with its original purpose selection, and fast-forward its context repositories. Use only when the human explicitly asks to update or refresh this workspace.
---

# Update workspace

Refresh this generated workspace without silently changing its identity or purpose scope.
This workflow changes machine-wide tooling and generated files, so inspect first and obtain
one explicit confirmation before running updates.

## Preflight

1. Work from the current directory and require `.merovingian/build.json`. If it is
   absent or invalid, stop: this is not a workspace that this workflow can safely rebuild.
2. Read the receipt's `namespace`, `user`, `schemaVersion`, and purpose selection:
   - schema 3: preserve `requestedPurposes` exactly; an empty array means full entitlement.
   - schema 2: do not infer scope from `CLAUDE.md`, `AGENTS.md`, or visible purposes. Ask the
     human for the original `--purposes` list or explicit permission to use full entitlement.
   - any other schema: stop and report that the receipt is unsupported.
3. Read `~/.merovingian/<namespace>/currentuser.json`. If the session is absent, tell the
   human to log in. If its user differs from the receipt, stop and explain the identity
   mismatch instead of replacing the projection for another user.
4. Inspect every distinct Git worktree reached through entries in `context/`. If any has
   uncommitted or staged changes, list it and stop so the human can commit or otherwise
   resolve the work. Never stash, reset, clean, discard, merge, or rebase it automatically.
5. Confirm that `bun` is available. Record the current `merovingian --version` when the
   command exists; a missing command is acceptable because the install step will add it.

## Confirm

Summarize the namespace, user, current CLI version, and purpose selection. State that the
operation will install the latest global CLI, regenerate this directory, and let `build`
fast-forward the entitled context repositories. Ask one explicit confirmation before doing
any of those mutations. Native sandbox or permission prompts may still appear separately.

## Update

After confirmation:

1. Run `bun add -g @supernova-labs/merovingian@latest`. If it fails, stop without rebuilding.
2. Refresh the shell's command lookup if necessary, run `merovingian --version`, and verify
   that `command -v merovingian` resolves consistently with Bun's global executable directory.
   If the reported command is still an older installation, stop and report the PATH conflict.
3. Run `merovingian build <namespace>` in the current directory. For a non-empty schema 3
   selection, append `--purposes <comma-separated requestedPurposes>` exactly. For a schema 2
   receipt, use only the selection the human approved during preflight.
4. Do not retry with fewer flags or broader access if the build rejects a purpose. Do not run
   `plugins sync`; report its warning separately if build recommends it.

## Report

Read the new receipt and confirm schema 3, namespace, user, and `requestedPurposes`. Summarize
the CLI version and context mounts from the build output. Treat any denied mount or failed pull
as a partial refresh and name it; do not claim the workspace is fully current.

If the CLI update succeeded but the build failed, say explicitly that machine tooling changed
while the workspace did not finish refreshing. Never repair generated `CLAUDE.md`, `AGENTS.md`,
settings, skills, agents, or context links by hand. The current build also does not remove stale
context symlinks. Finish by recommending that the human start a new agent session so the rebuilt
root instructions, skills, tools, and agents are loaded cleanly.
