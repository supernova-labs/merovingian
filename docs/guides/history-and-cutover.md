# Preserve history and retire the previous runtime

Version 1.0.0 removes workspace `build`, emitters, the HTTP build/auth service,
`library update`, `plugins sync`, inbox/decisions commands and MCP servers, and the
console inbox. New tenant scaffolding contains no library or client configuration.
Capabilities are installed from marketplaces through the tenant's setup skill.

## Administrative archive

Run from the Source checkout with explicit administrative `SURREAL_USER` and
`SURREAL_PASS`. The connection comes from the tenant configuration/environment.
Use an existing private parent directory; the destination must be new and either
outside Git or explicitly ignored.

```sh
bun bin/merovingian.ts history export --graph /path/to/tenant/graph.yaml --output /private/archives/tenant-before-major
bun bin/merovingian.ts history verify --archive /private/archives/tenant-before-major
```

Export is read-only. It captures `inbox`, `decision_domain`, `decision`, and
`decision_log`, plus exact bytes from the tenant's `decisions/` directory.
`history.surql` preserves native record IDs, links and datetimes. `decisions.json`
contains relative filenames and base64-encoded file bytes. `manifest.json` records
table counts, capture time, file sizes and SHA-256 hashes. Authentication definitions,
credentials, and unrelated tables are excluded. The directory is mode 0700; files
are mode 0600. Keep the archive in administrative storage and back it up there.

Capture compares two native exports and checks local files and counts again; any
observed concurrent change rejects the capture. This detects changes during capture,
not writes after it. Stop legacy writers and take a final archive at cutover.
Existing destinations are never overwritten. Verification detects corruption; its
hashes are not an independent signature against malicious replacement.

For a restoration rehearsal, import `history.surql` through the SurrealDB SDK into
an **isolated administrative database**, never over the active tenant. Compare
counts and records, including references and timestamps. Native exports may differ
in `DEFINE ... OVERWRITE` spelling after import; normalize only that schema modifier
when comparing exported text. Remove the rehearsal database afterwards. The SQL
retains its original table permission definitions, so the rehearsal database must
not be exposed to product users. Decoded local files remain an offline archive.

## New desired state

- Remove the top-level `agents` metadata catalog; purpose `agent` values must be
  explicit `plugin@marketplace` references.
- Declare every referenced skill as a plugin reference in `skills`.
- Put shared instructions in `ambient.instructions`. Local `library/` content and
  `decisions/` are no longer loaded or published by deploy.
- Remove pending and workspace-update capabilities. The journal stores new records;
  friction workflows belong to tenant plugins and their chosen issue tracker.
- Configure personal Catalog and Journal MCPs using individual credentials.
  Setup suggests authorized plugins and repositories and asks the human to approve.

## Database cutover

Deploy preserves existing historical records, does not reconcile old decisions or
rescope frictions, and sets existing historical tables to `PERMISSIONS NONE`.
This blocks every record identity from reading or writing them. Administrative
exports still work. Fresh databases do not create historical tables. Repeated
deploys keep the restriction. The new journal retains its own author/admin policy.

Prepare the plugin graph, publish the required marketplace content and update member
setup before applying the new runtime to a live tenant. Old clients will stop working
once the table restrictions are applied. A backup taken earlier is not the final
cutover snapshot if anyone has written since then.

The old friction review is a post-release task: inspect the administrative archive,
create issues for still-relevant work, and retain original identifiers as evidence.
It does not block the major. The complete documentation review and four-client
macOS acceptance remain release gates.
