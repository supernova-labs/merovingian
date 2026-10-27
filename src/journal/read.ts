import { DateTime, RecordId, type Surreal } from "surrealdb";
import { bounded } from "../provider/operation-error.ts";

export const journalFields = "record::id(id) AS id, record::id(author) AS author, text, origin, IF previous = NONE THEN NONE ELSE record::id(previous) END AS previous, at";
export interface JournalEntry { id: string; author: string; text: string; origin?: string; previous?: string; at: DateTime }
/** Authorization belongs to the authenticated database connection, never an author filter. */
export async function listJournals(db: Surreal, offset: number, limit: number, timeoutMs = 15_000) {
  const [entries] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal ORDER BY at DESC, id DESC LIMIT $limit START $offset`,
    { limit: limit + 1, offset }), timeoutMs);
  return { entries: entries.slice(0, limit), nextOffset: entries.length > limit ? offset + limit : null };
}


export interface JournalCursor { at: string; id: string }
export function parseJournalCursor(raw: string | null): JournalCursor | undefined {
  if (raw === null) return undefined;
  if (raw.length > 2048) throw new Error("Invalid journal cursor");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("at" in value) || !("id" in value) ||
      typeof value.at !== "string" || typeof value.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.id)) throw new Error("Invalid journal cursor");
  const at = new DateTime(value.at).toISOString();
  return { at, id: value.id };
}

/** Keyset paging for the console: concurrent appends cannot shift older pages. */
export async function pageJournals(db: Surreal, cursor: JournalCursor | undefined, limit: number, timeoutMs = 15_000) {
  const where = cursor ? "WHERE at <= $at AND (at < $at OR id < $id)" : "";
  const [rows] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal ${where} ORDER BY at DESC, id DESC LIMIT $limit`,
    { limit: limit + 1, ...(cursor ? { at: new DateTime(cursor.at), id: new RecordId("journal", cursor.id) } : {}) }), timeoutMs);
  const entries = rows.slice(0, limit), last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { at: last.at.toISOString(), id: last.id } : null };
}
