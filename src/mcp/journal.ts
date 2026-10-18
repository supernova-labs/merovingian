import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RecordId, type Surreal } from "surrealdb";
import { connectAsPassword } from "../provider/surreal.ts";
import { catalogConfig } from "../catalog/session.ts";

const appendSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  origin: z.string().max(1000).optional(),
  previous: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const listSchema = z.object({ offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
const fields = "record::id(id) AS id, record::id(author) AS author, text, origin, IF previous = NONE THEN NONE ELSE record::id(previous) END AS previous, at";

export function createJournalServer(connect: () => Promise<Surreal>): McpServer {
  const server = new McpServer({ name: "merovingian-journal", version: "1.0.0" });
  type Register = (name: string, config: { description: string; inputSchema: unknown }, callback: (args: unknown) => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>) => void;
  const register = server.registerTool.bind(server) as unknown as Register;
  const respond = (data: unknown, isError = false) => ({ isError, content: [{ type: "text" as const, text: JSON.stringify(data) }] });
  async function run(work: (db: Surreal) => Promise<unknown>) {
    let db: Surreal | undefined;
    try { db = await connect(); return respond(await work(db)); }
    catch { return respond({ error: { code: "journal_operation_failed", message: "Journal operation failed. For an append, verify the list before retrying; the write may have completed." } }, true); }
    finally { try { await db?.close(); } catch { /* Do not expose connection details or overwrite the operation result. */ } }
  }
  register("append-journal", { description: "Append immutable free text as the authenticated person. Optionally reference a previous visible journal entry by its id. Formatting belongs to the tenant's skill.", inputSchema: appendSchema }, async raw => {
    const args = appendSchema.parse(raw);
    return run(async db => {
      const previous = args.previous ? new RecordId("journal", args.previous) : undefined;
      if (previous) {
        const [visible] = await db.query<[unknown[]]>("SELECT id FROM $previous", { previous });
        if (visible.length !== 1) throw new Error("Reference unavailable");
      }
      const [rows] = await db.query<[{ id: unknown }[]]>(`CREATE journal SET text = $text, origin = $origin, previous = $previous RETURN ${fields}`, {
        text: args.text, origin: args.origin, previous: previous,
      });
      if (rows.length !== 1) throw new Error("Write not confirmed");
      return { entry: rows[0] };
    });
  });
  register("list-journals", { description: "List your journals, newest first. Explicit journal administrators see all entries in this tenant. No edit or delete operation is available.", inputSchema: listSchema }, async raw => {
    const args = listSchema.parse(raw);
    return run(async db => {
      const [entries] = await db.query<[unknown[]]>(`SELECT ${fields} FROM journal ORDER BY at DESC, id DESC LIMIT $limit START $offset`, { limit: args.limit + 1, offset: args.offset });
      const more = entries.length > args.limit;
      return { entries: entries.slice(0, args.limit), nextOffset: more ? args.offset + args.limit : null };
    });
  });
  return server;
}
export async function serveStdio(): Promise<void> {
  const config = catalogConfig();
  await createJournalServer(() => connectAsPassword(config.cfg, config.user, config.password)).connect(new StdioServerTransport());
}
