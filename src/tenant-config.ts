// Per-tenant connection config — `merovingian.toml` at the tenant repo root.
//
// The tenant's namespace picks the DATABASE; this file picks the SERVER. Authoring
// commands (deploy, reset) read it from the repo and REGISTER the url on this machine
// (~/.merovingian/<ns>/namespace.json), so namespace-keyed commands (build, login,
// inbox, decisions, data) reach the same server from anywhere — no env juggling.
//
// NO credentials live here (the file is committed): user/pass come from env
// (SURREAL_USER / SURREAL_PASS) or a gitignored .env in the tenant repo.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeNamespace, registeredSurrealUrl } from "./transport.ts";
import type { SurrealConfig } from "./provider/surreal.ts";

export const TENANT_CONFIG_FILE = "merovingian.toml";

export interface TenantConnection {
  url: string;
}

/** Read <tenantDir>/merovingian.toml. Returns null when the file is absent or
 *  declares no [surreal] url (both mean: use the defaults). Malformed toml throws. */
export function loadTenantConnection(tenantDir: string): TenantConnection | null {
  const path = join(tenantDir, TENANT_CONFIG_FILE);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid TOML: ${e instanceof Error ? e.message : e}`);
  }
  const surreal = (parsed as { surreal?: { url?: unknown } }).surreal;
  if (!surreal || surreal.url === undefined) return null;
  if (typeof surreal.url !== "string" || !/^wss?:\/\//.test(surreal.url)) {
    throw new Error(`${path}: [surreal] url must be a ws:// or wss:// string (got ${JSON.stringify(surreal.url)})`);
  }
  return { url: surreal.url };
}

/** Authoring-command entrypoint: resolve the tenant's connection overrides and keep
 *  the machine registry in sync. Registers only when the url actually changed, and
 *  says so — the registration is what makes `build <ns>` work from anywhere. */
export async function connectionOverrides(
  tenantDir: string,
  namespace: string,
  home?: string,
): Promise<Partial<SurrealConfig>> {
  const conn = loadTenantConnection(tenantDir);
  if (!conn) return {};
  if (registeredSurrealUrl(namespace, home) !== conn.url) {
    await writeNamespace(namespace, { transport: "surreal", url: conn.url }, home);
    console.log(`connection: ${conn.url} (${TENANT_CONFIG_FILE} — registered for "${namespace}" on this machine)`);
  }
  return { url: conn.url };
}
