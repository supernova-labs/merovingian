# Guide — releasing

How a Merovingian release ships, and the two version lines that must not be confused.

## The npm package (`@supernova-labs/merovingian`)

Releases are tag-driven — no token exists anywhere (npm **trusted publishing** via OIDC):

```bash
# 1. bump "version" in package.json (commit it)
# 2. tag and push
git tag v0.x.y && git push origin main v0.x.y
```

`.github/workflows/publish.yml` then: runs typecheck + the offline suite → verifies the tag
matches `package.json` and the version is not already on npm → sanity-checks the tarball
(runtime files present: `bin/`, `src/` incl. `src/init/templates/`, `surreal/`,
`fixtures/example/`; repo-only dirs absent) → `npm publish --provenance` → creates the GitHub
Release. The trusted publisher is configured on npmjs.com (package Settings → Trusted
Publisher → this repo + `publish.yml`); provenance is attested automatically.

Notes:

- **No `registry-url` in `setup-node`** — it writes an `.npmrc` expecting `NODE_AUTH_TOKEN`,
  which blocks the npm CLI's OIDC detection. Trusted publishing needs npm ≥ 11.5.1 (the
  workflow upgrades it).
- The tarball is a `files` **whitelist** in `package.json`. If a new runtime-read file lands
  outside `bin/ src/ surreal/ fixtures/example/`, add it there AND to the publish gate's
  required list.

## The governance plugin (independent version line)

The plugin (`plugin/`) is **not** part of the npm package — tenants install it via the GitHub
marketplace this repo carries (`.claude-plugin/`). Its version is independent of the package's.

**House rule: the two manifests bump together, always** — `.claude-plugin/marketplace.json`
AND `plugin/.claude-plugin/plugin.json`. The plugin updater reads the plugin's own manifest;
bumping only the marketplace one strands installed copies (learned the hard way). Any change
to `plugin/` content = bump both.

## Library templates (third distribution line)

`src/init/templates/library/` ships inside the npm package (used by `init` and
`library update` at runtime). Template changes reach existing tenants only when they run
`merovingian library update` — audit-first, their copies are theirs.
