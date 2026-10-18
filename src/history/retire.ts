import type { Surreal } from "surrealdb";
import { HISTORY_TABLES } from "./archive.ts";

/** Preserve existing bytes and identifiers, but retire every product-identity path.
 * Administrative exports remain possible. Absent historical tables stay absent.
 */
export async function restrictLegacyHistory(db: Surreal): Promise<void> {
  const [info] = await db.query<[{tables: Record<string, unknown>}]>("INFO FOR DB");
  if (!info?.tables || typeof info.tables !== "object") throw new Error("Cannot inspect legacy history permissions");
  for (const table of HISTORY_TABLES) {
    if (Object.hasOwn(info.tables, table)) await db.query(`ALTER TABLE ${table} PERMISSIONS NONE;`);
  }
}
