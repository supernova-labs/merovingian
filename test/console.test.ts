// The Architect console reads the provider DIRECTLY (god-view): the whole
// Definition + every human→purpose assignment, unscoped. These assertions cover
// listAssignments() (the new provider method) and the /graph handler shape,
// against BOTH backends — stub always, surreal when a DB is reachable.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { stubProviderFor } from "../src/provider/stub.ts";
import { SurrealProvider, surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { makeConsoleHandler, loadGraph, browserGraph, readConsoleJournals } from "../src/server/console.ts";
import type { AssignmentRow } from "../src/provider/types.ts";

const TEST_DB = "acme_console_test"; // own db — golden also uses acme_test (avoid racing the migrate)
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");

/** All rows for a user id (a human can hold several assignments). */
function rowsFor(rows: AssignmentRow[], uid: string): AssignmentRow[] {
  return rows.filter((r) => r.user.id === uid);
}

describe("listAssignments (stub)", () => {
  test("lists every human→purpose EDGE with role + scope", async () => {
    const rows = await stubProviderFor("acme").listAssignments();
    // ada holds TWO edges (root + content), both owner; ben one (member); cleo one (member, north)
    expect(rows.length).toBe(4);
    expect(rowsFor(rows, "ada").map((r) => ({ purpose: r.purpose, role: r.role })).sort((a, b) => a.purpose.localeCompare(b.purpose))).toEqual([
      { purpose: "acme", role: "owner" },
      { purpose: "content", role: "owner" },
    ]);
    expect(rowsFor(rows, "ben")).toEqual([
      { user: { id: "ben", name: "Ben", github: "ben-gh" }, purpose: "content", role: "member" },
    ]);
    expect(rowsFor(rows, "cleo")[0]).toMatchObject({ purpose: "delivery", scope: "north", role: "member" });
  });
});

describe("/graph handler (stub)", () => {
  const rawHandler = makeConsoleHandler("acme", "stub");
  const handler = async (req: Request) => {
    const html = await (await rawHandler(new Request("http://127.0.0.1/"))).text();
    req.headers.set("x-console-token", html.match(/name="console-token" content="([^"]+)"/)![1]!);
    return rawHandler(req);
  };

  test("GET /graph returns { definition, assignments }, unscoped god-view", async () => {
    const res = await handler(new Request("http://127.0.0.1/graph"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Awaited<ReturnType<typeof loadGraph>>;
    expect(body.definition.namespace).toBe("acme");
    expect(body.definition.purposes.length).toBeGreaterThan(0);
    // god-view: every EDGE present (ada holds 2), NOT scoped to one persona
    expect(body.assignments.length).toBe(4);
    expect(rowsFor(body.assignments, "cleo")[0]).toMatchObject({ purpose: "delivery", scope: "north", role: "member" });
  });

  test("GET / serves the HTML page", async () => {
    const res = await handler(new Request("http://127.0.0.1/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Architect Console");
  });

  test("unknown route → 404", async () => {
    const res = await handler(new Request("http://127.0.0.1/nope"));
    expect(res.status).toBe(404);
  });

  test("retired inbox route is unavailable", async () => {
    expect((await handler(new Request("http://127.0.0.1/inbox"))).status).toBe(404);
  });
});

// ---- surreal: only if a DB is reachable (migrated into a throwaway db) ----
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);
if (dbUp) await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });

(dbUp ? describe : describe.skip)("listAssignments (surreal)", () => {
  test("traverses responsible edges → same god-view as stub", async () => {
    const db = await connectSurreal(cfg);
    try {
      const rows = await new SurrealProvider(db, "acme").listAssignments();
      expect(rows.length).toBe(4); // ada(2) + ben(1) + cleo(1)
      expect(rowsFor(rows, "ada").map((r) => r.purpose).sort()).toEqual(["acme", "content"]);
      expect(rowsFor(rows, "ada").every((r) => r.role === "owner")).toBe(true);
      expect(rowsFor(rows, "cleo")[0]).toMatchObject({ purpose: "delivery", scope: "north", role: "member" });
      expect(rowsFor(rows, "ada")[0]?.user.github).toBe("ada-gh");
    } finally {
      await db.close();
    }
  });
});


for (const source of ["stub", "surreal"] as const) (source === "stub" || dbUp ? describe : describe.skip)(`console boundary (${source})`, () => {
  const graph = async () => {
    if (source === "stub") return loadGraph("acme", "stub");
    const db = await connectSurreal(cfg);
    try {
      const provider = new SurrealProvider(db, "acme");
      return { definition: await provider.getDefinition(), assignments: await provider.listAssignments() };
    } finally { await db.close(); }
  };
  async function session(backend: "stub" | "surreal" = "stub", dependencies = {}) {
    const handler = makeConsoleHandler("acme", backend, undefined, { graph, ...dependencies });
    const page = await handler(new Request("http://127.0.0.1/"));
    const html = await page.text();
    const token = html.match(/name="console-token" content="([^"]+)"/)![1]!;
    const get = (path: string, init?: RequestInit) => handler(new Request("http://127.0.0.1" + path,
      { ...init, headers: { "x-console-token": token, ...init?.headers } }));
    return { handler, get, page, html };
  }
  test("rejects remote origins, DNS rebinding, unauthenticated API and writes", async () => {
    const { handler, get, page, html } = await session();
    expect((await handler(new Request("http://evil.example/"))).status).toBe(403);
    expect((await get("/graph", { headers: { origin: "http://localhost:9999" } })).status).toBe(403);
    expect((await get("/", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/graph"))).status).toBe(403);
    expect((await get("/journals", { method: "POST" })).status).toBe(405);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).not.toContain("https://unpkg.com");
    expect(html).not.toContain("__CONSOLE_TOKEN__");
    const nonce = html.match(/nonce="([^"]+)"/)![1]!;
    const token = html.match(/name="console-token" content="([^"]+)"/)![1]!;
    expect(nonce).not.toBe(token);
    expect(page.headers.get("content-security-policy")).toContain(`script-src 'nonce-${nonce}'`);
    const otherPage = await (await handler(new Request("http://127.0.0.1/"))).text();
    expect(otherPage.match(/nonce="([^"]+)"/)![1]).not.toBe(nonce);
    expect(otherPage.match(/name="console-token" content="([^"]+)"/)![1]).toBe(token);
  });
  test("browser projection excludes executable tool config, library content and deployment policy", async () => {
    const data = structuredClone(await graph());
    data.definition.toolCatalog.secret = { kind: "stdio", command: "SECRET-command", args: ["SECRET-args"], env: { TOKEN: "SECRET-value" }, keySource: "company" };
    data.definition.skillCatalog.legacy = { source: "library", files: { "SKILL.md": "SECRET-library" } };
    data.definition.agentByPurpose.legacy = { source: "library", name: "legacy", content: "SECRET-agent" };
    data.definition.marketplaces.private = { claude: { name: "private", source: "https://user:SECRET-url@example.com" } };
    expect(JSON.stringify(browserGraph(data))).not.toContain("SECRET-");
    expect(browserGraph(data).definition.toolCatalog.secret!.requiredEnvironment).toEqual(["TOKEN"]);
  });
  test("catalog preview uses existing resolver and explicitly labels unverified access", async () => {
    const { get } = await session();
    const res = await get("/catalog?user=ben");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("administrative_preview");
    expect(body.identity.id).toBe("ben");
    expect(body.repositories).toHaveLength(3);
    expect(body.repositories.every((r: { effectiveAccess: string }) => r.effectiveAccess === "not_verified")).toBe(true);
    expect((await get("/catalog?user=missing")).status).toBe(404);
  });
  test("journal pagination is bounded and failure cannot expose SDK details", async () => {
    let calls = 0;
    const { get } = await session("surreal", { journals: async () => { calls++; throw new Error("password=TOPSECRET at private-host"); } });
    for (const q of ["offset=-1", "limit=101", "limit=0", "offset=NaN", "offset=1.2", "cursor=not-json", "cursor=%7B%7D"]) expect((await get("/journals?" + q)).status).toBe(400);
    expect(calls).toBe(0);
    const res = await get("/journals");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("TOPSECRET");
  });
  test("journals refuse missing personal credentials, never fall back to system credentials", async () => {
    await expect(readConsoleJournals("acme", undefined, 50, { SURREAL_URL: "ws://127.0.0.1:8000", SURREAL_NS: "merovingian", MEROVINGIAN_DB: "acme", SURREAL_USER: "root", SURREAL_PASS: "root" })).rejects.toThrow("Set MEROVINGIAN_USER");
  });
});
