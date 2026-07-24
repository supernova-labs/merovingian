// `merovingian data <namespace> <table>` — connect to Surreal AS the logged-in user
// (a scoped JWT identity, subject to PERMISSIONS) and list the rows they can
// actually SEE in a table. The live proof of enforcement — the backend decides.
// Generic on purpose (ADR 0011): the engine knows no domain table names.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SURREAL_IDENT } from "../graph/domain.ts";
import { sessionFile } from "../paths.ts";
import { connectAs, connectAsPassword, connectWithToken, surrealConfig } from "../provider/surreal.ts";
import type { Session } from "./login.ts";

/** Rows of `table` visible to `userId` under the enforced PERMISSIONS. */
export async function visibleRows(
  namespace: string,
  userId: string,
  table: string,
  surrealDb?: string,
): Promise<Record<string, unknown>[]> {
  if (!SURREAL_IDENT.test(table)) throw new Error(`"${table}" is not a safe table name`);
  const cfg = surrealConfig(namespace, surrealDb ? { db: surrealDb } : {});
  // token acquisition mirrors the MCP token-source order: the service (gh-auth) wins,
  // then the person's own password signin, then dev-mint (dev/test dbs only).
  const svc = process.env.MEROVINGIAN_SERVICE_URL;
  const pass = process.env.MEROVINGIAN_PASS;
  let db;
  if (svc) {
    const gh = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    const res = await fetch(`${svc}/token?namespace=${encodeURIComponent(namespace)}`, { headers: { Authorization: `Bearer ${gh}` } });
    const body = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !body.token) throw new Error(`/token: ${res.status} ${body.error ?? ""}`);
    db = await connectWithToken(cfg, body.token);
  } else if (pass) {
    db = await connectAsPassword(cfg, userId, pass);
  } else {
    db = await connectAs(cfg, userId);
  }
  try {
    const [rows] = await db.query<[Record<string, unknown>[]]>(
      "SELECT * FROM type::table($t) LIMIT 20",
      { t: table },
    );
    return rows;
  } finally {
    await db.close();
  }
}

export async function data(namespace: string, table: string): Promise<Record<string, unknown>[]> {
  const path = sessionFile(namespace);
  if (!existsSync(path)) {
    throw new Error(`not logged in to "${namespace}". Run: merovingian login ${namespace} <user>`);
  }
  const session = JSON.parse(await readFile(path, "utf8")) as Session;
  const rows = await visibleRows(namespace, session.user, table);

  console.log(`${table} rows visible to ${session.user} @ ${namespace} (enforced by Surreal):`);
  if (!rows.length) console.log("  (none — blocked by the backend, or the table is empty)");
  for (const r of rows) console.log(`  • ${JSON.stringify(r)}`);
  return rows;
}
