// `merovingian inbox <ns>` — the root-only governance drain surface (ADR 0009: the
// agent decides WHAT, the CLI is the only hand that touches Surreal). Lists the
// undrained learning-inbox entries (journal/friction, full text, ids visible) and,
// with --drain, stamps them drained. Entries are never deleted — history stays.

import { connectSurreal, surrealConfig } from "../provider/surreal.ts";
import { ensureDataSchema } from "../graph/apply.ts";

export interface InboxEntry {
  id: string;
  kind: "journal" | "friction";
  user: string;
  /** self-reported writer context (the purpose/agent acting), when given */
  origin: string | null;
  /** whose problem this is (ADR 0014) — a purpose id, or null = the root queue */
  scope: string | null;
  at: Date;
  text: string;
  drained: Date | null;
  /** the trace from problem to solution (PR link, commit, doc), when resolved */
  resolvedThrough: string | null;
}

interface RawEntry {
  id: string;
  kind: "journal" | "friction";
  user: string;
  origin?: string | null;
  scope?: string | null;
  at: unknown;
  text: string;
  drained?: unknown;
  resolved_through?: string | null;
}

// scope may be NONE — record::id(NONE) errors, hence the conditional.
const LIST_FIELDS =
  "record::id(id) AS id, kind, record::id(user) AS user, origin, " +
  "(IF scope IS NOT NONE THEN record::id(scope) ELSE NONE END) AS scope, at, text, drained, resolved_through";

// The driver decodes Surreal datetimes as its own nanosecond wrapper, not Date.
function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

/** Root read of the inbox. Default: undrained only; all=true includes drained. */
export async function listInbox(
  namespace: string,
  opts: { all?: boolean; surrealDb?: string } = {},
): Promise<InboxEntry[]> {
  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    const where = opts.all ? "" : " WHERE drained IS NONE";
    const [rows] = await db.query<[RawEntry[]]>(
      `SELECT ${LIST_FIELDS} FROM inbox${where} ORDER BY at ASC`,
    );
    return rows.map(({ resolved_through, ...r }) => ({
      ...r,
      origin: r.origin ?? null,
      scope: r.scope ?? null,
      resolvedThrough: resolved_through ?? null,
      at: asDate(r.at),
      drained: r.drained == null ? null : asDate(r.drained),
    }));
  } finally {
    await db.close();
  }
}

/** Stamp drained = now. ids narrows; without ids, every undrained entry. Idempotent
 *  (WHERE drained IS NONE). Returns the stamped ids. */
export async function drainInbox(
  namespace: string,
  opts: { ids?: string[]; surrealDb?: string } = {},
): Promise<string[]> {
  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    // Older dbs may predate the drained field — SCHEMAFULL silently drops writes
    // to an undefined field, so re-assert the (idempotent) engine schema first.
    await ensureDataSchema(db);
    const narrow = opts.ids ? " AND record::id(id) IN $ids" : "";
    const [rows] = await db.query<[{ id: string }[]]>(
      `UPDATE inbox SET drained = time::now() WHERE drained IS NONE${narrow} RETURN record::id(id) AS id`,
      opts.ids ? { ids: opts.ids } : {},
    );
    return rows.map((r) => r.id);
  } finally {
    await db.close();
  }
}

/** Root re-scope (the drain's triage, ADR 0014): move a friction to another
 *  purpose's queue — "não sou eu que resolvo" — or back to the root queue ("root"). */
export async function rescopeInbox(
  namespace: string,
  id: string,
  to: string,
  opts: { surrealDb?: string } = {},
): Promise<void> {
  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    await ensureDataSchema(db);
    if (to !== "root") {
      const [p] = await db.query<[unknown[]]>(`SELECT id FROM type::record("purpose", $to)`, { to });
      if (!p.length) throw new Error(`unknown purpose "${to}" in "${namespace}" — use a purpose id or "root"`);
    }
    const [rows] = await db.query<[unknown[]]>(
      to === "root"
        ? `UPDATE type::record("inbox", $id) SET scope = NONE`
        : `UPDATE type::record("inbox", $id) SET scope = type::record("purpose", $to)`,
      { id, to },
    );
    if (!rows.length) throw new Error(`inbox:${id} not found in "${namespace}"`);
  } finally {
    await db.close();
  }
}

/** CLI orchestrator: list (default), stamp, or re-scope. Rendered for an agent to read. */
export async function inbox(
  namespace: string,
  opts: { all?: boolean; drain?: boolean; ids?: string[]; rescope?: string; to?: string } = {},
): Promise<void> {
  if (opts.rescope) {
    if (!opts.to) throw new Error(`--rescope needs --to <purpose|root>`);
    await rescopeInbox(namespace, opts.rescope, opts.to);
    console.log(`✓ rescoped inbox:${opts.rescope} → ${opts.to === "root" ? "the root queue" : `purpose:${opts.to}`}`);
    return;
  }
  if (opts.drain) {
    const stamped = await drainInbox(namespace, { ids: opts.ids });
    if (!stamped.length) console.log("(nothing to drain)");
    else console.log(`✓ drained ${stamped.length} entr${stamped.length === 1 ? "y" : "ies"}: ${stamped.map((id) => `inbox:${id}`).join(", ")}`);
    return;
  }

  const entries = await listInbox(namespace, { all: opts.all });
  const undrained = entries.filter((e) => !e.drained).length;
  console.log(`inbox · ${namespace} — ${undrained} undrained entr${undrained === 1 ? "y" : "ies"}${opts.all ? ` (${entries.length} total)` : ""}`);
  if (!entries.length) {
    console.log(opts.all ? "(inbox is empty)" : "(inbox drained — no undrained entries)");
    return;
  }
  for (const e of entries) {
    const via = e.origin ? ` · via ${e.origin}` : "";
    const scope = ` · scope ${e.scope ?? "root"}`;
    const stamp = e.drained ? ` · drained ${e.drained.toISOString()}` : "";
    console.log(`\n── inbox:${e.id} · ${e.kind} · ${e.user}${via}${scope} · ${e.at.toISOString()}${stamp}`);
    if (e.resolvedThrough) console.log(`   resolved via: ${e.resolvedThrough}`);
    console.log(e.text);
  }
}
