import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./fs/atomic.ts";
import { namespaceFile } from "./paths.ts";

export type NamespaceConfig =
  | { transport: "surreal"; url: string };

export async function writeNamespace(namespace: string, cfg: NamespaceConfig, home?: string): Promise<void> {
  await writeJsonAtomic(namespaceFile(namespace, home), cfg);
}

/** The registered SurrealDB url for a namespace, or null. Sync — surrealConfig's
 *  resolution chain is sync and runs on every command. */
export function registeredSurrealUrl(namespace: string, home?: string): string | null {
  const p = namespaceFile(namespace, home);
  if (!existsSync(p)) return null;
  const cfg = JSON.parse(readFileSync(p, "utf8")) as NamespaceConfig;
  if (cfg.transport !== "surreal") throw new Error("Remote build service registrations are retired; configure a direct SurrealDB connection");
  return cfg.url;
}
