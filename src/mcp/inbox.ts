// Inbox MCP (ambient system tool): journal/friction → an append-only Surreal
// table, plus the LOCAL governance surface (ADR 0014): pending/resolve/rescope.
// Same shell as surreal-data — fetches a fresh scoped token per call and connects
// as the identity. The `user` is stamped server-side (VALUE $auth) and content is
// immutable post-create; `scope` routes the friction to the purpose that owns the
// problem, and the db filters every read/write by the REAL reach of the caller's
// lineage. This MCP is a vehicle — the PERMISSIONS decide.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { connectWithToken, type SurrealConfig } from "../provider/surreal.ts";
import { cfgFromEnv, envTokenSource } from "./token-source.ts";

export interface InboxOpts {
  cfg: SurrealConfig;
  getToken: () => Promise<string>;
  /** the caller's visible purposes (affordance for scope hints; NOT enforcement) */
  purposes?: string[];
}

/** MEROVINGIAN_PURPOSES — the projection's visible purposes (a JSON string[]). */
export function purposesFromEnv(env = process.env): string[] {
  try {
    const v = JSON.parse(env.MEROVINGIAN_PURPOSES ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// MCP SDK 1.29 + zod 3.25 → TS2589; contained cast (same as surreal-data).
type LooseRegister = (
  name: string,
  cfg: { description: string; inputSchema: Record<string, unknown> },
  cb: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[] }>,
) => void;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function scopeNote(scope: string | undefined, known: string[]): string {
  if (!scope) return " (unscoped — the root governance queue)";
  if (known.length && !known.includes(scope)) {
    return ` (scope purpose:${scope} — outside your projection; fine for escalation, but a typo lands in nobody's queue until root triages)`;
  }
  return ` (scope purpose:${scope})`;
}

function appendTool(server: McpServer, opts: InboxOpts, name: "journal" | "friction", description: string) {
  (server.registerTool as unknown as LooseRegister)(
    name,
    {
      description,
      inputSchema: {
        text: z.string().describe("the entry content"),
        origin: z.string().optional().describe("who is writing — the purpose/agent acting (e.g. 'delivery', 'shell')"),
        scope: z
          .string()
          .regex(SLUG)
          .optional()
          .describe(
            "whose problem this is — a purpose id. Yours if you can fix it with your mounts; an ancestor if it needs a wider reach; omit for the root governance queue.",
          ),
      },
    },
    async (args) => {
      const { text: entry, origin, scope } = args as { text: string; origin?: string; scope?: string };
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const sets = ["kind = $kind", "text = $text"];
        const params: Record<string, unknown> = { kind: name, text: entry };
        if (origin) {
          sets.push("origin = $origin");
          params.origin = origin;
        }
        if (scope) {
          sets.push(`scope = type::record("purpose", $scope)`);
          params.scope = scope;
        }
        await db.query(`CREATE inbox SET ${sets.join(", ")}`, params);
        return text(`${name} recorded${scopeNote(scope, opts.purposes ?? [])}.`);
      } finally {
        await db.close();
      }
    },
  );
}

interface PendingRow {
  id: string;
  origin: string | null;
  scope: string | null;
  at: unknown;
  text: string;
}

export function createInboxServer(opts: InboxOpts): McpServer {
  const server = new McpServer({ name: "inbox", version: "0.0.0" });
  appendTool(server, opts, "journal", "Record a journal entry (a learning / session log).");
  appendTool(
    server,
    opts,
    "friction",
    "Record a friction (something that got in the way) — scoped to the purpose that can fix it, drained by governance.",
  );

  (server.registerTool as unknown as LooseRegister)(
    "pending",
    {
      description:
        "List the undrained frictions within your reach (the db filters by your real lineage). The local governance surface — resolve what is operational, escalate what is structural.",
      inputSchema: {},
    },
    async () => {
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[PendingRow[]]>(
          `SELECT record::id(id) AS id, origin,
                  (IF scope IS NOT NONE THEN record::id(scope) ELSE NONE END) AS scope, at, text
           FROM inbox WHERE drained IS NONE AND kind = "friction" ORDER BY at ASC`,
        );
        if (!rows.length) return text("no pending frictions in your reach.");
        const body = rows
          .map((r) => `── inbox:${r.id} · scope ${r.scope ?? "root"}${r.origin ? ` · via ${r.origin}` : ""} · ${String(r.at)}\n${r.text}`)
          .join("\n\n");
        return text(`${rows.length} pending friction(s) in your reach:\n\n${body}`);
      } finally {
        await db.close();
      }
    },
  );

  (server.registerTool as unknown as LooseRegister)(
    "resolve",
    {
      description:
        "Resolve a pending friction in your reach: stamps it drained and records HOW it was resolved (a PR link, commit, doc — the trace from problem to solution).",
      inputSchema: {
        id: z.string().describe("the inbox entry id (without the 'inbox:' prefix)"),
        resolvedThrough: z.string().describe("the trace: PR/commit/doc link or a one-line description of the fix"),
      },
    },
    async (args) => {
      const { id, resolvedThrough } = args as { id: string; resolvedThrough: string };
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[unknown[]]>(
          `UPDATE type::record("inbox", $id) SET drained = time::now(), resolved_through = $rt WHERE drained IS NONE`,
          { id, rt: resolvedThrough },
        );
        // permission-filtered UPDATE is a SILENT no-op — say what happened.
        if (!rows.length) return text(`nothing resolved: inbox:${id} is not in your reach, does not exist, or is already drained.`);
        return text(`resolved inbox:${id} — drained, trace recorded.`);
      } finally {
        await db.close();
      }
    },
  );

  (server.registerTool as unknown as LooseRegister)(
    "rescope",
    {
      description:
        "Move a pending friction to another purpose WITHIN your reach (hand-off). Escalation beyond your reach happens when the friction is CREATED (scope any purpose) or by root governance.",
      inputSchema: {
        id: z.string().describe("the inbox entry id (without the 'inbox:' prefix)"),
        scope: z.string().regex(SLUG).describe("the destination purpose id"),
      },
    },
    async (args) => {
      const { id, scope } = args as { id: string; scope: string };
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[unknown[]]>(
          `UPDATE type::record("inbox", $id) SET scope = type::record("purpose", $scope)`,
          { id, scope },
        );
        if (!rows.length) {
          return text(
            `nothing moved: inbox:${id} is not in your reach, or purpose:${scope} is beyond it ` +
              `(the db checks the NEW scope too — escalate at creation or leave it to the root drain).`,
          );
        }
        return text(`rescoped inbox:${id} → purpose:${scope}.`);
      } finally {
        await db.close();
      }
    },
  );

  return server;
}

/** Run this MCP server on stdio — the `merovingian mcp` subcommand's target. */
export async function serveStdio(): Promise<void> {
  const cfg = cfgFromEnv();
  const server = createInboxServer({ cfg, getToken: envTokenSource(cfg), purposes: purposesFromEnv() });
  await server.connect(new StdioServerTransport());
  console.error(`inbox MCP running (stdio) — db=${cfg.db}`);
}

if (import.meta.main) serveStdio();
