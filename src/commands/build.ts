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
import { inspectCodexPlugins, readBuildStamp } from "./plugins.ts";

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

export function normalizeRequestedPurposes(purposes: string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const purpose of purposes ?? []) {
    const id = purpose.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export async function build(namespace: string, opts: BuildOpts = {}): Promise<Manifest> {
  const session = await readSession(namespace);
  const storeRoot = opts.storeRoot ?? repoStore(namespace);
  const remote = await remoteOptsFor(namespace);
  const requestedPurposes = normalizeRequestedPurposes(opts.purposes);

  const { service, close } = await buildServiceFor(namespace, { backend: opts.backend, storeRoot, asUser: session.user, ...remote });
  let manifest: Manifest;
  try {
    manifest = await service.getManifest(session.user, { purposes: requestedPurposes });
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
  const { files, degradations } = await emit(manifest, target, access, { requestedPurposes });

  // clone/pull the entitled okf repos and symlink them into ./context.
  const okf = await materializeOkf(manifest, target);

  console.log(`built ${namespace} workspace for ${manifest.user.name} (${assignmentsLabel(manifest.assignments)})`);
  for (const f of files) console.log(`  ${f}`);
  for (const o of okf.mounted) console.log(`  context/${o.bucket} -> ${o.path}`);
  for (const d of okf.denied) console.warn(`  ⚠ context/${d.bucket} not mounted (${d.repo}): ${d.reason}`);
  for (const degradation of degradations) {
    console.warn(
      `  ⚠ ${degradation.builder} omitted ${degradation.capability} "${degradation.resource}": ` +
        degradation.reason,
    );
  }
  const pluginStatus = await inspectCodexPlugins(await readBuildStamp(target));
  if (pluginStatus.unavailable) {
    console.warn(`  ⚠ could not verify Codex plugins: ${pluginStatus.unavailable}`);
  } else if (pluginStatus.missing.length) {
    console.warn(
      `  ⚠ missing Codex plugins: ${pluginStatus.missing.map((plugin) => plugin.nativeId).join(", ")}; ` +
        "run merovingian plugins sync",
    );
  }
  // uncatalogued tools ship as echo placeholders — say so instead of failing silently.
  for (const t of manifest.toolMounts) {
    if (t.command === "echo" && t.args[0] === `stub:${t.name}`) {
      console.warn(`  ⚠ tool "${t.name}" is not in the registry — emitted as a stub (catalog it in graph.yaml tools:)`);
    }
  }
  return manifest;
}
