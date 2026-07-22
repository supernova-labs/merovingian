// Decisions MCP (ambient system tool, ADR 0013): the workspace surface of the
// decision domain. Three tools — register-decision appends to the in-flight
// decision_log; search-decisions/get-decision consult the ratified records.
// Same shell as inbox/surreal-data: NO token held, a fresh scoped JWT per call;
// the domain list (MEROVINGIAN_DECISION_DOMAINS) is affordance for UX — the db
// enforces (decision_log permissions ride the domain owner's lineage; decision
// records are tenant-wide).
//
// Epistemic posture (the prompt side lives in the emitted CLAUDE.md): records are
// universal and binding; logs are jurisprudence UNDER CONSTRUCTION — confirm with
// a human before applying one.
//
// stdio server: stdout is the JSON-RPC channel — ALL logs go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RecordId } from "surrealdb";
import { z } from "zod";
import { connectWithToken, type SurrealConfig } from "../provider/surreal.ts";
import { cfgFromEnv, envTokenSource } from "./token-source.ts";

export interface DecisionsOpts {
  cfg: SurrealConfig;
  /** fetch a fresh scoped JWT — injectable so tests skip the service/gh */
  getToken: () => Promise<string>;
  /** the identity's reachable decision domains — env MEROVINGIAN_DECISION_DOMAINS */
  domains: string[];
}

/** Parse MEROVINGIAN_DECISION_DOMAINS (JSON string[]); absent/broken = none. */
export function domainsFromEnv(env = process.env): string[] {
  try {
    const parsed = JSON.parse(env.MEROVINGIAN_DECISION_DOMAINS ?? "[]") as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// MCP SDK 1.29 + zod 3.25 → TS2589; contained cast (same as the sibling servers).
type LooseRegister = (
  name: string,
  cfg: { description: string; inputSchema: Record<string, unknown> },
  cb: (args: Record<string, never>) => Promise<{ content: { type: "text"; text: string }[] }>,
) => void;

function text(t: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: t }] };
}

export function createDecisionsServer(opts: DecisionsOpts): McpServer {
  const server = new McpServer({ name: "decisions", version: "0.0.0" });
  const domainsHint = opts.domains.length ? ` Your domains: ${opts.domains.join(", ")}.` : "";

  (server.registerTool as unknown as LooseRegister)(
    "register-decision",
    {
      description:
        `Record an in-flight decision (a call made during work that is NOT yet official policy — ` +
        `governance later reviews it for promotion).${domainsHint}`,
      inputSchema: {
        decisionType: z.string().describe(`the decision domain${opts.domains.length ? `, one of: ${opts.domains.join(", ")}` : ""}`),
        text: z.string().describe("the decision, with context and rationale (what/why/cost of alternatives)"),
        records: z.array(z.string()).optional()
          .describe('ids of the ratified records this decision applied, if any (e.g. ["pricing/0001-enterprise-floor"])'),
      },
    },
    async (args) => {
      const { decisionType, text: body, records } = args as unknown as { decisionType: string; text: string; records?: string[] };
      if (opts.domains.length && !opts.domains.includes(decisionType)) {
        return text(`("${decisionType}" is not one of your decision domains: ${opts.domains.join(", ")})`);
      }
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [made] = await db.query<[unknown[]]>(
          "CREATE decision_log SET domain = $d, text = $t" + (records?.length ? ", records = $records" : ""),
          { d: decisionType, t: body, ...(records?.length ? { records: records.map((r) => new RecordId("decision", r)) } : {}) },
        );
        // a permission-blocked CREATE is a SILENT no-op — [] means nothing was written
        if (!made.length) {
          return text(`(decision NOT recorded — "${decisionType}" is not a declared domain of this tenant, or it is outside your reach)`);
        }
        return text(`decision recorded (${decisionType}).${records?.length ? ` Applied records: ${records.join(", ")}.` : ""}`);
      } finally {
        await db.close();
      }
    },
  );

  (server.registerTool as unknown as LooseRegister)(
    "search-decisions",
    {
      description:
        `Search the RATIFIED decision records (official jurisprudence — binding) of a domain.${domainsHint} ` +
        `In-flight logs are not searchable here; governance drains those.`,
      inputSchema: {
        decisionType: z.string().describe("the decision domain to search"),
        query: z.string().optional().describe("substring matched against title + content (case-insensitive)"),
        status: z.enum(["proposed", "accepted", "superseded"]).optional().describe("filter by status"),
        limit: z.number().optional().describe("max records (default 20, max 100)"),
      },
    },
    async (args) => {
      const { decisionType, query, status, limit } = args as unknown as { decisionType: string; query?: string; status?: string; limit?: number };
      const n = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 100);
      const clauses = ["domain = $d"];
      const params: Record<string, unknown> = { d: decisionType };
      if (status) {
        clauses.push("status = $s");
        params.s = status;
      }
      if (query) {
        clauses.push("(string::contains(string::lowercase(title), $q) OR string::contains(string::lowercase(content), $q))");
        params.q = query.toLowerCase();
      }
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[{ id: string; status: string; title: string; at: unknown }[]]>(
          `SELECT record::id(id) AS id, status, title, at FROM decision WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ${n}`,
          params,
        );
        if (!rows.length) return text("(no records — none exist in this domain, or the backend filtered them out)");
        return text(rows.map((r) => `${r.id} · ${r.status} · ${r.title}${r.at ? ` · ${String(r.at)}` : ""}`).join("\n"));
      } finally {
        await db.close();
      }
    },
  );

  (server.registerTool as unknown as LooseRegister)(
    "get-decision",
    {
      description: "Read one ratified decision record in full, by id (as returned by search-decisions).",
      inputSchema: {
        id: z.string().describe('the record id, e.g. "pricing/0001-enterprise-floor"'),
      },
    },
    async (args) => {
      const { id } = args as unknown as { id: string };
      const db = await connectWithToken(opts.cfg, await opts.getToken());
      try {
        const [rows] = await db.query<[{ domain: string; status: string; title: string; content: string; supersedes: unknown; at: unknown }[]]>(
          "SELECT domain, status, title, content, supersedes, at FROM type::record('decision', $id)",
          { id },
        );
        const r = rows[0];
        if (!r) return text(`(no record "${id}")`);
        const head = `# ${r.title}\ndomain: ${r.domain} · status: ${r.status}${r.at ? ` · ${String(r.at)}` : ""}${r.supersedes ? ` · supersedes: ${String(r.supersedes)}` : ""}`;
        return text(`${head}\n\n${r.content}`);
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
  const server = createDecisionsServer({ cfg, getToken: envTokenSource(cfg), domains: domainsFromEnv() });
  await server.connect(new StdioServerTransport());
  console.error(`decisions MCP running (stdio) — db=${cfg.db}`);
}

if (import.meta.main) serveStdio();
