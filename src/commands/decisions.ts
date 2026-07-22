// `merovingian decisions <ns>` — the root-only governance surface of the in-flight
// decision LOG (ADR 0013; sibling of `inbox`). Lists undrained entries — domain,
// author, full text, and the ratified records each one applied (the jurisprudence
// telemetry the drain pass reads) — and, with --drain, stamps them drained.
// Entries are never deleted; the ratified records live in `decisions/` + deploy.

import { connectSurreal, surrealConfig } from "../provider/surreal.ts";
import { ensureDataSchema } from "../graph/apply.ts";

export interface DecisionLogEntry {
  id: string;
  domain: string;
  user: string;
  at: Date;
  text: string;
  /** ids of the ratified records this decision applied */
  records: string[];
  drained: Date | null;
}

interface RawEntry {
  id: string;
  domain: string;
  user: string;
  at: unknown;
  text: string;
  records?: string[];
  drained?: unknown;
}

const LIST_FIELDS =
  "record::id(id) AS id, domain, record::id(user) AS user, at, text, (records ?? []).map(|$r| record::id($r)) AS records, drained";

// The driver decodes Surreal datetimes as its own nanosecond wrapper, not Date.
function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

/** Root read of the decision log. Default: undrained only; all=true includes drained. */
export async function listDecisionLog(
  namespace: string,
  opts: { all?: boolean; surrealDb?: string } = {},
): Promise<DecisionLogEntry[]> {
  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    const where = opts.all ? "" : " WHERE drained IS NONE";
    const [rows] = await db.query<[RawEntry[]]>(
      `SELECT ${LIST_FIELDS} FROM decision_log${where} ORDER BY at ASC`,
    );
    return rows.map((r) => ({
      ...r,
      records: r.records ?? [],
      at: asDate(r.at),
      drained: r.drained == null ? null : asDate(r.drained),
    }));
  } finally {
    await db.close();
  }
}

/** Stamp drained = now. ids narrows; without ids, every undrained entry. Idempotent
 *  (WHERE drained IS NONE). Returns the stamped ids. */
export async function drainDecisionLog(
  namespace: string,
  opts: { ids?: string[]; surrealDb?: string } = {},
): Promise<string[]> {
  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    // Older dbs may predate the table — SCHEMAFULL silently drops writes to an
    // undefined field, so re-assert the (idempotent) engine schema first.
    await ensureDataSchema(db);
    const narrow = opts.ids ? " AND record::id(id) IN $ids" : "";
    const [rows] = await db.query<[{ id: string }[]]>(
      `UPDATE decision_log SET drained = time::now() WHERE drained IS NONE${narrow} RETURN record::id(id) AS id`,
      opts.ids ? { ids: opts.ids } : {},
    );
    return rows.map((r) => r.id);
  } finally {
    await db.close();
  }
}

/** CLI orchestrator: list (default) or stamp. Rendered for an agent to read. */
export async function decisions(
  namespace: string,
  opts: { all?: boolean; drain?: boolean; ids?: string[] } = {},
): Promise<void> {
  if (opts.drain) {
    const stamped = await drainDecisionLog(namespace, { ids: opts.ids });
    if (!stamped.length) console.log("(nothing to drain)");
    else console.log(`✓ drained ${stamped.length} entr${stamped.length === 1 ? "y" : "ies"}: ${stamped.map((id) => `decision_log:${id}`).join(", ")}`);
    return;
  }

  const entries = await listDecisionLog(namespace, { all: opts.all });
  const undrained = entries.filter((e) => !e.drained).length;
  console.log(`decision log · ${namespace} — ${undrained} undrained entr${undrained === 1 ? "y" : "ies"}${opts.all ? ` (${entries.length} total)` : ""}`);
  if (!entries.length) {
    console.log(opts.all ? "(decision log is empty)" : "(log drained — no undrained entries)");
    return;
  }
  for (const e of entries) {
    const stamp = e.drained ? ` · drained ${e.drained.toISOString()}` : "";
    console.log(`\n── decision_log:${e.id} · ${e.domain} · ${e.user} · ${e.at.toISOString()}${stamp}`);
    if (e.records.length) console.log(`   applies: ${e.records.map((r) => `decision:${r}`).join(", ")}`);
    console.log(e.text);
  }
}
