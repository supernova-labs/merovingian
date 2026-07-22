// `merovingian build <namespace> [--purposes a,b] [--backend surreal]`
// (run inside the target workspace folder)
//
// Reads the current identity, asks the BUILD SERVICE for a scoped manifest
// (the CLI never touches the graph/DB), ensures the central repo store exists
// (stub), and materializes the workspace in the cwd.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { emit, type SurrealAccess } from "../projection/emit.ts";
import { sessionFile, repoStore } from "../paths.ts";
import { buildServiceFor, defaultBackend, type Backend } from "../service/build-service.ts";
import { materializeOkf } from "../store/okf.ts";
import { surrealConfig } from "../provider/surreal.ts";
import { remoteOptsFor } from "../transport.ts";
import type { Session } from "./login.ts";
import { assignmentsLabel, type Manifest } from "../projection/resolve.ts";

async function readSession(namespace: string): Promise<Session> {
  const path = sessionFile(namespace);
  if (!existsSync(path)) {
    throw new Error(`not logged in to "${namespace}". Run: merovingian login ${namespace} <user>`);
  }
  return JSON.parse(await readFile(path, "utf8")) as Session;
}

export interface BuildOpts {
  targetDir?: string;
  storeRoot?: string;
  purposes?: string[];
  backend?: Backend;
}

export async function build(namespace: string, opts: BuildOpts = {}): Promise<Manifest> {
  const session = await readSession(namespace);
  const storeRoot = opts.storeRoot ?? repoStore(namespace);
  const remote = await remoteOptsFor(namespace);

  const { service, close } = await buildServiceFor(namespace, { backend: opts.backend, storeRoot, ...remote });
  let manifest: Manifest;
  try {
    manifest = await service.getManifest(session.user, { purposes: opts.purposes });
  } finally {
    await close();
  }

  // surreal-data access: a token SOURCE (no JWT embedded — the MCP fetches per-call).
  // remote → point at the service (gh); local-surreal → dev-mint as the user.
  let access: SurrealAccess | undefined;
  const isSurreal = !!remote || defaultBackend(opts.backend) === "surreal";
  if (isSurreal) {
    const cfg = surrealConfig(namespace);
    access = {
      url: cfg.url,
      ns: cfg.ns,
      db: cfg.db,
      ...(remote ? { service: remote.remote.url, namespace } : { user: session.user }),
    };
  }

  const target = opts.targetDir ?? process.cwd();
  const { files } = await emit(manifest, target, access);

  // clone/pull the entitled okf repos and symlink them into ./context.
  const okf = await materializeOkf(manifest, target);

  console.log(`built ${namespace} workspace for ${manifest.user.name} (${assignmentsLabel(manifest.assignments)})`);
  for (const f of files) console.log(`  ${f}`);
  for (const o of okf.mounted) console.log(`  context/${o.bucket} -> ${o.path}`);
  for (const d of okf.denied) console.warn(`  ⚠ context/${d.bucket} not mounted (${d.repo}): ${d.reason}`);
  // uncatalogued tools ship as echo placeholders — say so instead of failing silently.
  for (const t of manifest.toolMounts) {
    if (t.command === "echo" && t.args[0] === `stub:${t.name}`) {
      console.warn(`  ⚠ tool "${t.name}" is not in the registry — emitted as a stub (catalog it in graph.yaml tools:)`);
    }
  }
  return manifest;
}
