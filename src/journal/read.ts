import type { Surreal } from "surrealdb";
import { bounded } from "../provider/operation-error.ts";

export const journalFields = "record::id(id) AS id, record::id(author) AS author, text, origin, IF previous = NONE THEN NONE ELSE record::id(previous) END AS previous, at";
export interface JournalEntry { id: string; author: string; text: string; origin?: string; previous?: string; at: string }
/** Authorization belongs to the authenticated database connection, never an author filter. */
export async function listJournals(db: Surreal, offset: number, limit: number, timeoutMs = 15_000) {
  const [entries] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal ORDER BY at DESC, id DESC LIMIT $limit START $offset`,
    { limit: limit + 1, offset }), timeoutMs);
  return { entries: entries.slice(0, limit), nextOffset: entries.length > limit ? offset + limit : null };
}
