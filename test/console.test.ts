// The Architect console reads the provider DIRECTLY (god-view): the whole
// Definition + every human→purpose assignment, unscoped. These assertions cover
// listAssignments() (the new provider method) and the /graph handler shape,
// against BOTH backends — stub always, surreal when a DB is reachable.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { stubProviderFor } from "../src/provider/stub.ts";
import { SurrealProvider, surrealConfig, surrealReachable, connectSurreal, connectWithToken, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { makeConsoleHandler, loadGraph, loadInbox } from "../src/server/console.ts";
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
  const handler = makeConsoleHandler("acme", "stub");

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

  test("GET /inbox on the stub → an empty inbox (no runtime data), not an error", async () => {
    const res = await handler(new Request("http://127.0.0.1/inbox"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });
});

// ---- surreal: only if a DB is reachable (migrated into a throwaway db) ----
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);
if (dbUp) await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });

(dbUp ? describe : describe.skip)("/inbox god-view (surreal)", () => {
  test("shows every entry — drained and undrained, newest first, user stamped", async () => {
    // reset wipes STRUCTURE only — inbox rows survive across runs; start clean.
    const root = await connectSurreal(cfg);
    try {
      await root.query("DELETE inbox");
    } finally {
      await root.close();
    }
    // seed as MEMBERS (the console never writes): user is stamped by the db.
    for (const [uid, kind, text] of [["ada", "journal", "wrote the launch plan"], ["cleo", "friction", "the tracker stub broke"]] as const) {
      const db = await connectWithToken(cfg, mintIdentityJwt(cfg, uid));
      try {
        await db.query(`CREATE inbox SET kind = $kind, text = $text`, { kind, text });
      } finally {
        await db.close();
      }
    }
    const { entries } = await loadInbox("acme", "surreal", TEST_DB);
    expect(entries.length).toBe(2);
    // newest first: cleo's friction was created last. scope rides along (null = root queue).
    expect(entries[0]).toMatchObject({ kind: "friction", user: "cleo", text: "the tracker stub broke", drained: null, scope: null });
    expect(entries[1]).toMatchObject({ kind: "journal", user: "ada" });
  });
});

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
