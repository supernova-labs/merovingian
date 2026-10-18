# Guide — releasing

Documentation and local plugin versions alone do not constitute a published release.
Confirm the requested version in npm and its GitHub Release before declaring publication complete. Release approval and production deployment are separate.

## Before tagging

Review the [cutover runbook](history-and-cutover.md), archive/restore evidence,
[client acceptance](../testing/desktop-mcp-smoke.md), and all current product docs.
Run `bun run typecheck`, `bun test`, the Surreal-backed suite, plugin validation, and
inspect a locally packed npm tarball. Confirm that examples use the new runtime and
that removed templates, emitters, and old command surfaces are absent.

Choose and commit the package version only when ready to release. An approved `v` tag
matching `package.json` triggers `.github/workflows/publish.yml`. That workflow runs
checks, rejects an already published version, verifies runtime files in the tarball,
publishes through npm trusted publishing/OIDC, and creates a GitHub Release.
Manual dispatch requires an existing version tag and runs the same checks.

The npm `files` allowlist includes `bin/`, `src/`, `surreal/`, and the synthetic example.
Update the workflow's required-file gate whenever runtime assets change. The package
excludes docs, tests and the governance plugin. The workflow upgrades npm for OIDC;
do not introduce a registry token or a `setup-node` registry configuration by habit.

## Governance plugin

The repository's Claude marketplace distributes `plugin/` independently of npm.
Any plugin content change must update **both** `.claude-plugin/marketplace.json`
and `plugin/.claude-plugin/plugin.json` to the same plugin version. Validate the
marketplace and plugin with the native client before publishing their source revision.
The current administrative agent packaging targets Claude; shared skill prose alone
does not demonstrate native packaging for another client.

There is no library-template distribution line. Tenant behavior lives in its plugins;
`init` creates graph/configuration scaffolding without workspace or skill templates.
