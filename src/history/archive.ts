import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, chmod, readdir, lstat, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import type { Surreal, SqlExportOptions } from "surrealdb";

export const HISTORY_TABLES = ["inbox", "decision_domain", "decision", "decision_log"] as const;
export const exportOptions = (tables: string[]): Partial<SqlExportOptions> => ({
  tables, records: true, versions: false, users: false, accesses: false,
  params: false, functions: false, analyzers: false, apis: false, buckets: false,
  modules: false, configs: false, sequences: false,
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface HistorySource {
  inspect(): Promise<{ tables: string[]; counts: Record<string, number> }>;
  export(tables: string[]): Promise<string>;
}
export function databaseHistory(db: Surreal): HistorySource {
  return {
    async inspect() {
      const [info] = await db.query<[{ tables: Record<string, unknown> }]>("INFO FOR DB;");
      if (!info || !info.tables || typeof info.tables !== "object") throw new Error("Cannot inspect history tables");
      const tables = HISTORY_TABLES.filter(t => Object.hasOwn(info.tables, t));
      const counts: Record<string, number> = {};
      for (const t of tables) {
        const [rows] = await db.query<[{ count: number }[]]>(`SELECT count() AS count FROM ${t} GROUP ALL;`);
        counts[t] = rows[0]?.count ?? 0;
      }
      return { tables, counts };
    },
    export: async tables => tables.length ? await db.export(exportOptions(tables)) : "-- No legacy history tables present.\n",
  };
}
async function decisionFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(dir: string, prefix: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" && !prefix) return; throw e; }
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error("History archive refuses symlinked decision files");
      if (entry.isDirectory()) await walk(path, rel + "/");
      else if (entry.isFile()) files[rel] = (await readFile(path)).toString("base64");
      else throw new Error("Unsupported decision file type");
    }
  }
  const stat = await lstat(root).catch(e => { if (e.code === "ENOENT") return null; throw e; });
  if (stat?.isSymbolicLink()) throw new Error("History archive refuses a symlinked decisions directory");
  await walk(root, ""); return files;
}
/** Read-only capture. Never drains, stamps, deletes, migrates, or redefines live data. */
export async function archiveHistory(source: HistorySource, opts: { tenant: string; tenantDir: string; output: string }) {
  const output = resolve(opts.output), parent = dirname(output);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Archive parent must be an existing real directory");
  await mkdir(output, { mode: 0o700 }); // exclusive: existing destinations are never overwritten
  try {
    const before = await source.inspect();
    if (before.tables.some(t => !HISTORY_TABLES.includes(t as typeof HISTORY_TABLES[number]))) throw new Error("Unexpected history table");
    const localBefore = await decisionFiles(join(opts.tenantDir, "decisions"));
    const sql = await source.export(before.tables);
    const confirmation = await source.export(before.tables);
    const after = await source.inspect();
    const localAfter = await decisionFiles(join(opts.tenantDir, "decisions"));
    if (sql !== confirmation || JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(localBefore) !== JSON.stringify(localAfter)) {
      throw new Error("History changed during capture; retry when legacy writers are idle");
    }
    if (!sql.trim()) throw new Error("Empty database export");
    const payloads = { "history.surql": sql, "decisions.json": JSON.stringify(localBefore, null, 2) + "\n" };
    const manifest = { format: 1, tenant: opts.tenant, capturedAt: new Date().toISOString(),
      tables: before.tables, counts: before.counts, missingTables: HISTORY_TABLES.filter(t => !before.tables.includes(t)),
      localFiles: Object.keys(localBefore).length, files: Object.fromEntries(Object.entries(payloads).map(([name, content]) => [name, { sha256: hash(content), bytes: Buffer.byteLength(content) }])),
      note: "Restricted administrative archive. Native SurrealQL preserves record identifiers and references. Restore only into an isolated database; no credentials or access definitions exported." };
    for (const [name, content] of Object.entries({ ...payloads, "manifest.json": JSON.stringify(manifest, null, 2) + "\n" })) {
      await writeFile(join(output, name), content, { mode: 0o600, flag: "wx" });
      await chmod(join(output, name), 0o600);
    }
    await verifyArchive(output);
    return { output, tables: manifest.tables, counts: manifest.counts, localFiles: manifest.localFiles };
  } catch (e) {
    await rm(output, { recursive: true, force: true }); // only the new directory created above
    throw e;
  }
}
export async function verifyArchive(output: string) {
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  if (manifest.format !== 1) throw new Error("Unsupported archive format");
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(["decisions.json", "history.surql"])) throw new Error("Invalid archive file list");
  for (const [name, expected] of Object.entries(manifest.files) as [string, {sha256:string;bytes:number}][]) {
    const text = await readFile(join(output, name), "utf8");
    if (hash(text) !== expected.sha256 || Buffer.byteLength(text) !== expected.bytes) throw new Error(`Archive integrity failure: ${name}`);
  }
  return { tenant: manifest.tenant, counts: manifest.counts };
}
