# Machine layout

| Path | Owner and purpose |
|---|---|
| Tenant repository `graph.yaml` | Administrative desired state |
| Tenant `merovingian.toml` | Optional direct connection URL; no credentials |
| `~/.merovingian/<tenant>/namespace.json` | Operator CLI's registered direct Surreal endpoint |
| `~/.merovingian/<tenant>/currentuser.json` | CLI session metadata; no password or token |
| `~/.merovingian/update-check.json` | Cache for passive package-version notice |
| Native client configuration | Private Catalog/Journal process settings and individual credentials |
| Native plugin installation | Managed by the client and tenant setup workflow |
| Chosen personal clone directory | Authorized KB clones, reusable across projects |
| Private archive directory | Historical export; directory 0700 and files 0600, outside Git or ignored |

The internal resolver retains a default repo-store path under `~/merovingian/<tenant>/repos`
for diagnostics; Catalog does not expose server filesystem paths, and setup is not required
to use that location. The engine no longer generates workspace roots, MCP files, agent files,
context symlinks or build stamps. Existing files are not automatically deleted.

Native clients differ in installation and trust scope. Let the tenant setup inspect actual
state rather than assuming a universal config filename. The required release matrix is macOS;
Windows and Linux are outside this initial client-setup acceptance gate.
