import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parseArgs } from "node:util";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { archiveHistory, databaseHistory, verifyArchive } from "../history/archive.ts";
import { resolveGraphPath } from "../graph/load-graph.ts";
import { loadTenantConnection } from "../tenant-config.ts";
import { connectSurreal, surrealConfig } from "../provider/surreal.ts";

export async function historyCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    graph: { type: "string" }, output: { type: "string" }, archive: { type: "string" },
  } });
  if (positionals.length !== 1) throw new Error("Use history export --graph PATH --output NEW_DIRECTORY or history verify --archive DIRECTORY");
  if (positionals[0] === "verify" && values.archive) { console.log(await verifyArchive(values.archive)); return; }
  if (positionals[0] !== "export" || !values.output) throw new Error("history export requires --output NEW_DIRECTORY");
  const graphPath = resolveGraphPath(values.graph), tenantDir = dirname(graphPath);
  const namespace = parseYaml(readFileSync(graphPath, "utf8"))?.namespace;
  if (typeof namespace !== "string" || !namespace.trim()) throw new Error("Historical graph needs a namespace");
  if (!process.env.SURREAL_USER || !process.env.SURREAL_PASS) throw new Error("Explicit administrative SURREAL_USER and SURREAL_PASS are required for history export");
  // Archives must not accidentally enter a repository. An ignored destination is allowed.
  const output = resolve(values.output);
  try {
    execFileSync("git", ["-C", dirname(output), "rev-parse", "--show-toplevel"], { stdio: "ignore" });
    try { execFileSync("git", ["-C", dirname(output), "check-ignore", "--quiet", output], { stdio: "ignore" }); }
    catch { throw new Error("History archive destination must be outside Git or explicitly ignored"); }
  } catch (e) { if (e instanceof Error && e.message.startsWith("History archive")) throw e; }
  const connection = loadTenantConnection(tenantDir);
  const cfg = surrealConfig(namespace, connection ? { url: connection.url } : {});
  const db = await connectSurreal(cfg);
  try { console.log(await archiveHistory(databaseHistory(db), { tenant: namespace, tenantDir, output })); }
  finally { await db.close(); }
}
