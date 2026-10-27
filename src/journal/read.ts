import { DateTime, RecordId, type Surreal } from "surrealdb";
import { bounded } from "../provider/operation-error.ts";

export const journalFields = "record::id(id) AS id, record::id(author) AS author, text, origin, IF previous = NONE THEN NONE ELSE record::id(previous) END AS previous, at";
export type JournalId = string | number;
export interface JournalEntry { id: JournalId; author: string; text: string; origin?: string; previous?: JournalId; at: DateTime }
/** Authorization belongs to the authenticated database connection, never an author filter. */
export async function listJournals(db: Surreal, offset: number, limit: number, timeoutMs = 15_000) {
  const [entries] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal ORDER BY at DESC, id DESC LIMIT $limit START $offset`,
    { limit: limit + 1, offset }), timeoutMs);
  return { entries: entries.slice(0, limit), nextOffset: entries.length > limit ? offset + limit : null };
}


export interface JournalCursor { at: string; id: JournalId }
export function parseJournalId(value: unknown): JournalId {
  if (typeof value === "string" && value.length > 0 && value.length <= 255) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error("Invalid journal identifier");
}
export function parseJournalCursor(raw: string | null): JournalCursor | undefined {
  if (raw === null) return undefined;
  if (raw.length > 2048) throw new Error("Invalid journal cursor");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("at" in value) || !("id" in value) ||
      typeof value.at !== "string") throw new Error("Invalid journal cursor");
  const at = new DateTime(value.at).toISOString();
  return { at, id: parseJournalId(value.id) };
}

/** Keyset paging for the console: concurrent appends cannot shift older pages. */
export interface JournalFilter { author?: string; from?: string; until?: string }
function filterQuery(filter: JournalFilter) {
  const conditions: string[] = [], vars: Record<string, unknown> = {};
  if (filter.author) { conditions.push("author = $author"); vars.author = new RecordId("user", filter.author); }
  if (filter.from) { conditions.push("at >= $from"); vars.from = new DateTime(filter.from); }
  if (filter.until) { conditions.push("at < $until"); vars.until = new DateTime(filter.until); }
  return { conditions, vars };
}
export async function pageJournals(db: Surreal, cursor: JournalCursor | undefined, limit: number, timeoutMs = 15_000, filter: JournalFilter = {}) {
  const { conditions, vars } = filterQuery(filter);
  if (cursor) conditions.push("at <= $at AND (at < $at OR id < $id)");
  const where = conditions.length ? "WHERE " + conditions.map(c => `(${c})`).join(" AND ") : "";
  const [rows] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal ${where} ORDER BY at DESC, id DESC LIMIT $limit`,
    { ...vars, limit: limit + 1, ...(cursor ? { at: new DateTime(cursor.at), id: new RecordId("journal", cursor.id) } : {}) }), timeoutMs);
  const entries = rows.slice(0, limit), last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { at: last.at.toISOString(), id: last.id } : null };
}


/** Calendar boundaries come from the browser's local midnights, including DST. */
export async function journalActivity(db: Surreal, boundaries: string[], author?: string, timeoutMs = 15_000) {
  const vars: Record<string, unknown> = author ? { author: new RecordId("user", author) } : {};
  const queries = boundaries.slice(0, -1).map((from, i) => {
    vars[`from${i}`] = new DateTime(from); vars[`until${i}`] = new DateTime(boundaries[i + 1]!);
    return `SELECT count() AS count FROM journal WHERE at >= $from${i} AND at < $until${i}${author ? " AND author = $author" : ""} GROUP ALL`;
  });
  // One bounded round-trip, at most sixty indexed date ranges. Database permissions
  // apply before every count, just as they do before listing entry content.
  const rows = await bounded(db.query<{ count: number }[][]>(queries.join(";"), vars), timeoutMs);
  return { days: boundaries.slice(0, -1).map((from, i) => ({ from, until: boundaries[i + 1]!, count: rows[i]?.[0]?.count ?? 0 })) };
}

/** References never grant access: both the entry and its continuations are read as the caller. */
export async function journalDetail(db: Surreal, id: JournalId, timeoutMs = 15_000) {
  const record = new RecordId("journal", id);
  const [entries] = await bounded(db.query<[JournalEntry[]]>(`SELECT ${journalFields} FROM $record`, { record }), timeoutMs);
  if (!entries[0]) return { entry: null, continuations: [], moreContinuations: false };
  const [children] = await bounded(db.query<[JournalEntry[]]>(
    `SELECT ${journalFields} FROM journal WHERE previous = $record ORDER BY at DESC, id DESC LIMIT 21`, { record }), timeoutMs);
  return { entry: entries[0], continuations: children.slice(0, 20), moreContinuations: children.length > 20 };
}
