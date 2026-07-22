// MCP server for scoped Surreal data (the `surreal-data` system tool). MANIFEST-DRIVEN
// (ADR 0011): the engine knows no domain table names — the identity's bucket mounts
// arrive via MEROVINGIAN_BUCKETS (the manifest's SurrealMount[], stamped by emit), and
// two GENERIC tools serve them. The mount list is affordance, never authority:
// enforcement is the db's — every query runs under the caller's scoped JWT and
// SurrealDB PERMISSIONS decide the rows.
//
// It holds NO token — it fetches a FRESH scoped JWT per call (from the build/auth
// service via gh, or dev-minted locally) and connects with it. Expiry stops mattering.
//
// stdio server: stdout is the JSON-RPC channel — ALL logs go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SURREAL_IDENT } from "../graph/domain.ts";
import { connectWithToken, type SurrealConfig } from "../provider/surreal.ts";
import { cfgFromEnv, envTokenSource } from "./token-source.ts";

/** The manifest's surreal mounts, as emit stamps them (resolve.ts SurrealMount). */
export interface BucketMount {
  bucket: string;
  tables: string[];
  /** "<rowScope>:<value>" when the granting assignment is scoped */
  scope?: string;
}

export interface SurrealDataOpts {
  cfg: SurrealConfig;
  /** fetch a fresh scoped JWT — injectable so tests skip the service/gh */
  getToken: () => Promise<string>;
  /** the identity's bucket mounts — env MEROVINGIAN_BUCKETS in production */
  mounts: BucketMount[];
}

/** Parse MEROVINGIAN_BUCKETS (JSON SurrealMount[]); absent/broken = no mounts. */
export function mountsFromEnv(env = process.env): BucketMount[] {
  try {
    const parsed = JSON.parse(env.MEROVINGIAN_BUCKETS ?? "[]") as BucketMount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// MCP SDK 1.29 + zod 3.25 → TS2589 when inferring registerTool with inputSchema; contained cast.
type LooseRegister = (
  name: string,
  cfg: { description: string; inputSchema: Record<string, unknown> },
  cb: (args: { table: string; filter?: Record<string, string | number | boolean>; limit?: number }) => Promise<{ content: { type: "text"; text: string }[] }>,
) => void;

export function createSurrealDataServer(opts: SurrealDataOpts): McpServer {
  const server = new McpServer({ name: "surreal-data", version: "0.0.0" });
  const allTables = [...new Set(opts.mounts.flatMap((m) => m.tables))].sort();

  server.registerTool(
    "tables",
    {
      description: "List the data buckets and tables your identity can reach (from your build manifest).",
      inputSchema: {},
    },
    async () => {
      const text = opts.mounts.length
        ? opts.mounts
            .map((m) => `${m.bucket} — tables: ${m.tables.join(", ")}${m.scope ? ` — scope: ${m.scope}` : ""}`)
            .join("\n")
        : "(no data buckets in this workspace)";
      return { content: [{ type: "text", text }] };
    },
  );

  (server.registerTool as unknown as LooseRegister)(
    "select",
    {
      description:
        `Select rows from a table your identity can reach` +
        (allTables.length ? ` (${allTables.join(", ")})` : "") +
        `. Enforced by SurrealDB — you only ever see permitted rows.`,
      inputSchema: {
        table: z.string().describe(`the table to read${allTables.length ? `, one of: ${allTables.join(", ")}` : ""}`),
        filter: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
          .describe("equality filters, ANDed (e.g. {\"account\": \"north\"})"),
        limit: z.number().optional().describe("max rows (default 50, max 200)"),
      },
    },
    async ({ table, filter, limit }) => {
      if (!allTables.includes(table)) {
        return { content: [{ type: "text", text: `("${table}" is not in your workspace — run the tables tool)` }] };
      }
      const clauses: string[] = [];
      const params: Record<string, unknown> = { t: table };
      for (const [i, [k, v]] of Object.entries(filter ?? {}).entries()) {
        if (!SURREAL_IDENT.test(k)) {
          return { content: [{ type: "text", text: `(invalid filter field "${k}")` }] };
        }
        clauses.push(`${k} = $v${i}`);
        params[`v${i}`] = v;
      }
      const n = Math.min(Math.max(Math.trunc(limit ?? 50), 1), 200);
      const sql =
        `SELECT * FROM type::table($t)` +
        (clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "") +
        ` LIMIT ${n}`;
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[Record<string, unknown>[]]>(sql, params);
        const text = rows.length
          ? JSON.stringify(rows, null, 2)
          : "(no rows — none exist or the backend filtered them out)";
        return { content: [{ type: "text", text }] };
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
  const server = createSurrealDataServer({ cfg, getToken: envTokenSource(cfg), mounts: mountsFromEnv() });
  await server.connect(new StdioServerTransport());
  console.error(`surreal-data MCP running (stdio) — db=${cfg.db}`);
}

if (import.meta.main) serveStdio();
