// `merovingian graph <namespace> [--backend surreal]` — show the logged-in
// user's personal access graph: everything they're entitled to. A dry-run
// projection (full entitlement) via the build service, no files written.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sessionFile } from "../paths.ts";
import { accessServiceFor, type Backend } from "../service/access.ts";
import type { Session } from "./login.ts";
import { assignmentsLabel, type Manifest } from "../projection/resolve.ts";

export function renderGraph(m: Manifest): string {
  const lines: string[] = [];
  lines.push(`access for ${m.user.name} @ ${m.namespace}`);
  lines.push(`  assignments: ${assignmentsLabel(m.assignments)}`);
  lines.push("");
  lines.push(`  purposes:`);
  for (const p of m.visiblePurposes) lines.push(`    • ${p}`);
  lines.push("");
  lines.push(`  okf context:    ${m.okf.map((o) => o.bucket).join(", ") || "—"}`);
  lines.push(
    `  surreal data:   ${m.surreal.map((s) => s.bucket + (s.scope ? `(${s.scope})` : "")).join(", ") || "—"}`,
  );
  lines.push(`  tools:          ${m.tools.join(", ") || "—"}`);
  lines.push(`  plugins:        ${m.plugins.join(", ")}`);
  return lines.join("\n");
}

export interface GraphOpts {
  backend?: Backend;
}

export async function graph(namespace: string, opts: GraphOpts = {}): Promise<Manifest> {
  const path = sessionFile(namespace);
  if (!existsSync(path)) {
    throw new Error(`not logged in to "${namespace}". Run: merovingian login ${namespace} <user>`);
  }
  const session = JSON.parse(await readFile(path, "utf8")) as Session;

  const { service, close } = await accessServiceFor(namespace, { backend: opts.backend, asUser: session.user });
  let manifest: Manifest;
  try {
    manifest = await service.getManifest(session.user); // full entitlement
  } finally {
    await close();
  }

  console.log(renderGraph(manifest));
  return manifest;
}
