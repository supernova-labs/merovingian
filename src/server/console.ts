// The Architect's console — a LOCAL, read-only, NO-AUTH web view of the WHOLE
// tenant graph (god-view). Deliberately a SEPARATE server from the gh-authed
// build/auth service (service.ts): different trust models must not share a
// handler. Binds to 127.0.0.1 only — localhost-trust is the whole auth story
// for this prototype slice (gh-auth/gating is a later slice; see MVP.md).
//
// It reads the provider DIRECTLY (getDefinition + listAssignments) — NOT through
// the BuildService, which scopes per-persona (the wrong shape for a god-view).

import { connectSurreal, surrealConfig, SurrealProvider } from "../provider/surreal.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { defaultBackend, type Backend } from "../service/build-service.ts";
import { listInbox, type InboxEntry } from "../commands/inbox.ts";
import type { Definition, AssignmentRow } from "../provider/types.ts";

export interface GraphPayload {
  definition: Definition;
  assignments: AssignmentRow[];
}

/** Read the whole graph + every assignment from the chosen backend. Surreal
 *  connects per-call (like the build/auth service) so no stale socket lingers. */
export async function loadGraph(namespace: string, backend: Backend): Promise<GraphPayload> {
  if (backend === "surreal") {
    const db = await connectSurreal(surrealConfig(namespace));
    try {
      const provider = new SurrealProvider(db, namespace);
      const [definition, assignments] = await Promise.all([provider.getDefinition(), provider.listAssignments()]);
      return { definition, assignments };
    } finally {
      await db.close();
    }
  }
  const provider = stubProviderFor(namespace);
  const [definition, assignments] = await Promise.all([provider.getDefinition(), provider.listAssignments()]);
  return { definition, assignments };
}

export interface InboxPayload {
  entries: InboxEntry[];
}

/** God-view of the learning inbox (journal/friction), newest first. The stub
 *  backend has no runtime data — an empty inbox, not an error. */
export async function loadInbox(namespace: string, backend: Backend, surrealDb?: string): Promise<InboxPayload> {
  if (backend !== "surreal") return { entries: [] };
  const entries = await listInbox(namespace, { all: true, ...(surrealDb ? { surrealDb } : {}) });
  return { entries: entries.reverse() };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch handler: GET / (the page) and GET /graph (the god-view payload). */
export function makeConsoleHandler(
  namespace: string,
  backend: Backend,
  htmlUrl: URL = new URL("./console.html", import.meta.url),
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(htmlUrl), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/graph") {
      try {
        return json(200, await loadGraph(namespace, backend));
      } catch (e) {
        return json(502, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (url.pathname === "/inbox") {
      try {
        return json(200, await loadInbox(namespace, backend));
      } catch (e) {
        return json(502, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(404, { error: "not found" });
  };
}

export interface ConsoleOpts {
  namespace?: string;
  backend?: Backend;
  port?: number;
}

/** Start the console (Bun.serve, 127.0.0.1 only). Returns the server (call .stop()). */
export function startConsole(opts: ConsoleOpts = {}): {
  port: number;
  namespace: string;
  backend: Backend;
  stop: () => void;
} {
  const namespace = opts.namespace ?? "acme";
  const backend = defaultBackend(opts.backend);
  const port = opts.port ?? Number(process.env.CONSOLE_PORT ?? 8888);
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: makeConsoleHandler(namespace, backend) });
  return { port: server.port ?? port, namespace, backend, stop: () => server.stop(true) };
}
