// Local administrative graph viewer. Journal reads use a separate personal identity.
// Loopback is an operator trust boundary, not a multi-user web authentication system.
import { connectAsPassword, connectSurreal, surrealConfig, SurrealProvider } from "../provider/surreal.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { defaultBackend, type Backend } from "../service/access.ts";
import type { Definition, AssignmentRow } from "../provider/types.ts";
import { CatalogError, resolveCatalog } from "../catalog/catalog.ts";
import { catalogConfig } from "../catalog/session.ts";
import { bounded, operationError } from "../provider/operation-error.ts";
import { journalMarkdown } from "../journal/markdown.ts";
import type { Surreal } from "surrealdb";
import { pageJournals, parseJournalCursor, type JournalCursor, type JournalFilter, type JournalId, parseJournalId, journalActivity, journalDetail } from "../journal/read.ts";

export interface GraphPayload { definition: Definition; assignments: AssignmentRow[] }
export async function loadGraph(namespace: string, backend: Backend): Promise<GraphPayload> {
  if (backend === "surreal") {
    const db = await connectSurreal(surrealConfig(namespace));
    try {
      const provider = new SurrealProvider(db, namespace);
      const [definition, assignments] = await bounded(Promise.all([provider.getDefinition(), provider.listAssignments()]), 15_000);
      return { definition, assignments };
    } finally { await db.close().catch(() => {}); }
  }
  const provider = stubProviderFor(namespace);
  const [definition, assignments] = await Promise.all([provider.getDefinition(), provider.listAssignments()]);
  return { definition, assignments };
}

/** Explicit browser projection: no tool command/args/env values, library bodies or deployment policy. */
export function browserGraph({ definition: d, assignments }: GraphPayload) {
  const plugins = (refs: Definition["skillCatalog"] | Definition["agentByPurpose"]) => Object.fromEntries(
    Object.entries(refs).filter(([, r]) => r.source === "plugin").map(([id, r]) => [id,
      r.source === "plugin" ? { source: r.source, plugin: r.plugin, marketplace: r.marketplace } : undefined]));
  const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  return { assignments, definition: {
    namespace: d.namespace, ambient: { skills: d.ambient.skills, instructions: d.ambient.instructions ?? "" },
    purposes: d.purposes, buckets: d.buckets.map(b => ({ ...b, repo: b.repo && repo.test(b.repo) ? b.repo : undefined })),
    skillCatalog: plugins(d.skillCatalog), agentByPurpose: plugins(d.agentByPurpose),
    toolCatalog: Object.fromEntries(Object.entries(d.toolCatalog).map(([id, t]) => [id, {
      kind: t.kind, requiredEnvironment: Object.keys(t.env), credentialSource: t.keySource,
    }])),
    marketplaces: Object.fromEntries(Object.entries(d.marketplaces).map(([id, m]) => [id,
      Object.fromEntries((["claude", "codex"] as const).map(client => {
        const binding = m[client];
        return [client, binding && repo.test(binding.source)
          ? { status: "available", name: binding.name, source: binding.source }
          : { status: "unsupported" }];
      }))])),
  } };
}

async function withJournalIdentity<T extends object>(namespace: string, env: Record<string, string | undefined>, read: (db: Surreal) => Promise<T>) {
  const config = catalogConfig(env);
  // Never let a console for one tenant silently read a different configured tenant.
  const graphConfig = surrealConfig(namespace);
  if (config.cfg.db !== graphConfig.db || config.cfg.ns !== graphConfig.ns ||
      new URL(config.cfg.url).toString() !== new URL(graphConfig.url).toString()) {
    throw new CatalogError("invalid_configuration", "Journal identity must use the same connection and tenant as this console.");
  }
  let db;
  try { db = await connectAsPassword(config.cfg, config.user, config.password); }
  catch (error) {
    const failure = operationError(error, true);
    throw new CatalogError(failure.code, failure.message);
  }
  try {
    const [users] = await bounded(db.query<[{ id: string; journalAdmin?: boolean }[]]>(
      "SELECT record::id(id) AS id, journalAdmin FROM user WHERE id = $auth"), 15_000);
    if (users.length !== 1 || users[0]!.id !== config.user) throw new CatalogError("access_denied", "Authenticated identity is unavailable.");
    return { ...await read(db), identity: config.user,
      scope: users[0]!.journalAdmin === true ? "tenant" : "personal" };
  } finally { await db.close().catch(() => {}); }
}

export async function readConsoleJournals(namespace: string, cursor: JournalCursor | undefined, limit: number,
  env: Record<string, string | undefined> = process.env, filter: JournalFilter = {}) {
  return withJournalIdentity(namespace, env, async db => {
    const page = await pageJournals(db, cursor, limit, 15_000, filter);
    return { ...page, entries: page.entries.map(entry => ({ ...entry, html: journalMarkdown(entry.text) })) };
  });
}
export async function readConsoleJournalActivity(namespace: string, boundaries: string[], author?: string,
  env: Record<string, string | undefined> = process.env) {
  return withJournalIdentity(namespace, env, db => journalActivity(db, boundaries, author));
}
export async function readConsoleJournalDetail(namespace: string, id: JournalId,
  env: Record<string, string | undefined> = process.env) {
  return withJournalIdentity(namespace, env, async db => {
    const detail = await journalDetail(db, id);
    return { ...detail, entry: detail.entry ? { ...detail.entry, html: journalMarkdown(detail.entry.text) } : null };
  });
}
function journalFilter(params: URLSearchParams): JournalFilter {
  const author = params.get("author") || undefined;
  if (author && (author.length > 128 || /[\x00-\x1f]/.test(author))) throw new Error("Invalid author");
  const from = params.get("from") || undefined, until = params.get("until") || undefined;
  if (Boolean(from) !== Boolean(until) || (from && (from.length > 64 || until!.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(from) || !/^\d{4}-\d{2}-\d{2}T/.test(until!) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(until!)) || Date.parse(from) >= Date.parse(until!)))) throw new Error("Invalid dates");
  return { author, from, until };
}
function activityBoundaries(raw: string | null): string[] {
  if (!raw || raw.length > 5000) throw new Error("Invalid calendar");
  const dates: unknown = JSON.parse(raw);
  if (!Array.isArray(dates) || ![31, 61].includes(dates.length)) throw new Error("Invalid calendar");
  for (let i = 0; i < dates.length; i++) {
    const value = dates[i];
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid calendar");
    if (i && (Date.parse(value) - Date.parse(dates[i-1]) < 20*3600_000 || Date.parse(value) - Date.parse(dates[i-1]) > 28*3600_000)) throw new Error("Invalid calendar");
  }
  return dates;
}

interface ConsoleDependencies {
  graph?: () => Promise<GraphPayload>;
  journals?: (cursor: JournalCursor | undefined, limit: number, filter: JournalFilter) => Promise<unknown>;
}
export function makeConsoleHandler(namespace: string, backend: Backend,
  htmlUrl: URL = new URL("./console.html", import.meta.url), dependencies: ConsoleDependencies = {}) {
  const token = crypto.randomUUID();
  const load = dependencies.graph ?? (() => loadGraph(namespace, backend));
  const headers = {
    "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, "content-type": "application/json" },
  });
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // Reject DNS rebinding and cross-origin access, including pages on other local ports.
    if (!["127.0.0.1", "localhost"].includes(url.hostname) ||
        (req.headers.has("origin") && req.headers.get("origin") !== url.origin) ||
        ["cross-site", "same-site"].includes(req.headers.get("sec-fetch-site") ?? "")) {
      return json(403, { error: "Local same-origin access required." });
    }
    if (req.method !== "GET") return json(405, { error: "Read-only console." });
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers });
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const nonce = crypto.randomUUID();
      const html = (await Bun.file(htmlUrl).text()).replaceAll("__CONSOLE_TOKEN__", token).replaceAll("__CONSOLE_NONCE__", nonce);
      return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8",
        "content-security-policy": headers["content-security-policy"].replace("script-src 'none'", `script-src 'nonce-${nonce}'`),
      } });
    }
    if (!["/graph", "/catalog", "/journals", "/journal", "/journal-activity"].includes(url.pathname)) return json(404, { error: "Not found." });
    if (req.headers.get("x-console-token") !== token) return json(403, { error: "Reload the console to authorize this local session." });
    try {
      if (url.pathname === "/graph") return json(200, browserGraph(await load()));
      if (url.pathname === "/catalog") {
        const { definition, assignments } = await load();
        const id = url.searchParams.get("user");
        const rows = assignments.filter(a => a.user.id === id);
        if (!rows.length) return json(404, { error: "No assignments for this person." });
        const catalog = resolveCatalog(definition, { ...rows[0]!.user,
          assignments: rows.map(({ purpose, role, scope }) => ({ purpose, role, scope })) });
        return json(200, { ...catalog, mode: "administrative_preview" });
      }
      let filter: JournalFilter;
      try { filter = journalFilter(url.searchParams); }
      catch { return json(400, { error: "Invalid journal filters." }); }
      if (url.pathname === "/journal") {
        let id: JournalId;
        try { id = parseJournalId(JSON.parse(url.searchParams.get("id") ?? "null")); }
        catch { return json(400, { error: "Invalid journal identifier." }); }
        if (backend === "stub") return json(404, { error: "Journal not found or not visible." });
        const detail = await readConsoleJournalDetail(namespace, id);
        return detail.entry ? json(200, detail) : json(404, { error: "Journal not found or not visible." });
      }
      if (url.pathname === "/journal-activity") {
        let boundaries: string[];
        try { boundaries = activityBoundaries(url.searchParams.get("boundaries")); }
        catch { return json(400, { error: "Invalid calendar range." }); }
        if (backend === "stub") return json(200, { identity: null, scope: "demo", days: boundaries.slice(0,-1).map((from,i)=>({from,until:boundaries[i+1],count:0})) });
        return json(200, await readConsoleJournalActivity(namespace, boundaries, filter.author));
      }
      let cursor: JournalCursor | undefined;
      try { cursor = parseJournalCursor(url.searchParams.get("cursor")); }
      catch { return json(400, { error: "Invalid journal cursor." }); }
      const limit = Number(url.searchParams.get("limit") ?? 50);
      if (url.searchParams.has("offset") || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return json(400, { error: "Invalid pagination." });
      }
      if (backend === "stub") return json(200, { entries: [], nextCursor: null, identity: null, scope: "demo" });
      return json(200, await (dependencies.journals ?? ((o, l, f) => readConsoleJournals(namespace, o, l, process.env, f)))(cursor, limit, filter));
    } catch (error) {
      const failure = error instanceof CatalogError ? { code: error.code, message: error.message } : operationError(error, false);
      return json(502, { error: failure.message, code: failure.code });
    }
  };
}

export interface ConsoleOpts { namespace?: string; backend?: Backend; port?: number }
export function startConsole(opts: ConsoleOpts = {}) {
  const namespace = opts.namespace ?? "acme";
  const backend = defaultBackend(opts.backend);
  const port = opts.port ?? Number(process.env.CONSOLE_PORT ?? 8888);
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: makeConsoleHandler(namespace, backend) });
  return { port: server.port ?? port, namespace, backend, stop: () => server.stop(true) };
}
