import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NotAllowedError, RecordId, type Surreal } from "surrealdb";
import { connectAsPassword } from "../provider/surreal.ts";
import { bounded, operationError } from "../provider/operation-error.ts";
import { journalFields as fields, listJournals } from "../journal/read.ts";
import { catalogConfig } from "../catalog/session.ts";

const appendSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  origin: z.string().max(1000).optional(),
  previous: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const listSchema = z.object({ offset: z.number().int().min(0).max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
class ReferenceUnavailable extends Error {}

export function createJournalServer(connect: () => Promise<Surreal>, timeoutMs = 15_000): McpServer {
  const server = new McpServer({ name: "merovingian-journal", version: "1.0.0" });
  type Register = (name: string, config: { description: string; inputSchema: unknown }, callback: (args: unknown) => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>) => void;
  const register = server.registerTool.bind(server) as unknown as Register;
  const respond = (data: unknown, isError = false) => ({ isError, content: [{ type: "text" as const, text: JSON.stringify(data) }] });
  async function run(operation: "append" | "list", work: (db: Surreal, submitting: () => void) => Promise<unknown>) {
    let db: Surreal | undefined;
    const state: { phase: "connect" | "read" | "write" } = { phase: "connect" };
    try {
      db = await connect(); state.phase = "read";
      return respond(await work(db, () => { state.phase = "write"; }));
    } catch (error) {
      const failure = error instanceof ReferenceUnavailable
        ? { code: "reference_unavailable", message: "The previous journal entry does not exist or is not visible to you. Verify its id." }
        : operationError(error, state.phase === "connect");
      const writeOutcome = operation === "list" ? "not_applicable" : state.phase === "write" ? error instanceof NotAllowedError ? "refused" : "unknown" : "not_submitted";
      return respond({ error: { ...failure, operation, phase: state.phase, writeOutcome,
        message: failure.message + (writeOutcome === "unknown"
          ? " The append may have completed. List journals and verify the entry before retrying; do not automatically repeat the append."
          : writeOutcome === "refused" ? " The database refused the append; no journal entry was committed. Resolve the access problem before retrying."
          : writeOutcome === "not_submitted" ? " No journal write was submitted." : " No journal write was attempted; retry the list after resolving the problem.") } }, true);
    } finally { try { await db?.close(); } catch { /* Cleanup cannot replace the result. */ } }
  }

  register("append-journal", { description: "Append immutable free text as the authenticated person. Optionally reference a previous visible journal entry by its id. Formatting belongs to the tenant's skill.", inputSchema: appendSchema }, async raw => {
    const args = appendSchema.parse(raw);
    return run("append", async (db, submitting) => {
      const previous = args.previous ? new RecordId("journal", args.previous) : undefined;
      if (previous) {
        const [visible] = await bounded(db.query<[unknown[]]>("SELECT id FROM $previous", { previous }), timeoutMs);
        if (visible.length !== 1) throw new ReferenceUnavailable();
      }
      submitting();
      const [rows] = await bounded(db.query<[{ id: unknown }[]]>(`CREATE journal SET text = $text, origin = $origin, previous = $previous RETURN ${fields}`, {
        text: args.text, origin: args.origin, previous: previous,
      }), timeoutMs);
      if (rows.length !== 1) throw new Error("Write not confirmed");
      return { entry: rows[0] };
    });
  });
  register("list-journals", { description: "List your journals, newest first. Explicit journal administrators see all entries in this tenant. No edit or delete operation is available.", inputSchema: listSchema }, async raw => {
    const args = listSchema.parse(raw);
    return run("list", db => listJournals(db, args.offset, args.limit, timeoutMs));
  });
  return server;
}
export async function serveStdio(): Promise<void> {
  const config = catalogConfig();
  await createJournalServer(() => connectAsPassword(config.cfg, config.user, config.password)).connect(new StdioServerTransport());
}
