// `merovingian reset [--graph <path>]` — DEV/TEST: wipe the structural tables and
// reproject the graph. Reads the graph.yaml from --graph / cwd (a tenant repo); the
// namespace comes from the yaml. Thin wrapper over applyGraph(reset:true). Touches
// ONLY structural tables — never runtime data. NEVER run it on a live tenant: the
// surgical, referrer-safe converge is `deploy apply` (both share applyGraph, and
// apply bootstraps a virgin db by itself — reset exists only to start over).

import { dirname } from "node:path";
import type { Surreal } from "surrealdb";
import { connectSurreal, surrealConfig, type SurrealConfig } from "../provider/surreal.ts";
import { connectionOverrides } from "../tenant-config.ts";
import { loadGraphFile, resolveGraphPath } from "../graph/load-graph.ts";
import { applyGraph } from "../graph/apply.ts";
import type { Definition, User } from "../provider/types.ts";

/** Reset a connected db to the desired definition (wipe structural + project). */
export async function projectInto(db: Surreal, def: Definition, users: Record<string, User>): Promise<void> {
  await applyGraph(db, def, users, { reset: true });
}

export interface ResetOpts {
  graph?: string;
  surrealDb?: string;
}

export async function reset(opts: ResetOpts = {}): Promise<void> {
  const graphPath = resolveGraphPath(opts.graph);
  const { definition, users, warnings } = loadGraphFile(graphPath);
  const namespace = definition.namespace;
  for (const warning of warnings) console.warn(`⚠ ${warning}`);
  const conn = await connectionOverrides(dirname(graphPath), namespace);
  const cfg: SurrealConfig = surrealConfig(namespace, { ...conn, ...(opts.surrealDb ? { db: opts.surrealDb } : {}) });
  const db = await connectSurreal(cfg);
  try {
    await applyGraph(db, definition, users, { reset: true });
  } finally {
    await db.close();
  }

  console.log(
    `reset ${namespace} → surreal (${cfg.url} ns=${cfg.ns} db=${cfg.db}): ` +
      `${definition.purposes.length} purposes, ${definition.buckets.length} buckets, ${Object.keys(users).length} users`,
  );
}
