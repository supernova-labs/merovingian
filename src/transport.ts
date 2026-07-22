// Machine-side transport registry: is a namespace served locally (stub/surreal)
// or by a remote build/auth service? And the gh credential the remote needs.
//
// Two entry shapes live in ~/.merovingian/<ns>/namespace.json:
//   { transport: "remote",  url }  — a build/auth service endpoint (login/build over HTTP)
//   { transport: "surreal", url }  — a direct SurrealDB url for this tenant (registered by
//     authoring commands from the tenant repo's merovingian.toml, read by surrealConfig)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "./fs/atomic.ts";
import { namespaceFile } from "./paths.ts";

export type NamespaceConfig =
  | { transport: "remote"; url: string }
  | { transport: "surreal"; url: string };

export async function writeNamespace(namespace: string, cfg: NamespaceConfig, home?: string): Promise<void> {
  await writeJsonAtomic(namespaceFile(namespace, home), cfg);
}

export async function readNamespace(namespace: string, home?: string): Promise<NamespaceConfig | null> {
  const p = namespaceFile(namespace, home);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8")) as NamespaceConfig;
}

/** The registered SurrealDB url for a namespace, or null. Sync — surrealConfig's
 *  resolution chain is sync and runs on every command. */
export function registeredSurrealUrl(namespace: string, home?: string): string | null {
  const p = namespaceFile(namespace, home);
  if (!existsSync(p)) return null;
  const cfg = JSON.parse(readFileSync(p, "utf8")) as NamespaceConfig;
  return cfg.transport === "surreal" ? cfg.url : null;
}

/** The user's GitHub token, reused from the local `gh` CLI (no OAuth app needed). */
export function ghToken(): string {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error('could not get the gh token — run "gh auth login"');
  }
}

/** Remote service opts for a namespace, or undefined if it's served locally
 *  (no entry, or a direct-surreal entry). */
export async function remoteOptsFor(namespace: string, home?: string): Promise<{ remote: { url: string; ghToken: string } } | undefined> {
  const cfg = await readNamespace(namespace, home);
  if (!cfg || cfg.transport !== "remote") return undefined;
  return { remote: { url: cfg.url, ghToken: ghToken() } };
}
