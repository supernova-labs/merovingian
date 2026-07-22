// Enforcement: the backend BARS — not the build. We connect as scoped JWT
// identities (subject to PERMISSIONS) and prove the DB returns only allowed rows.
// The killer case is ben: even handed a clients connection, he gets ZERO.
//
// Needs a live SurrealDB (own throwaway db, isolated from the golden suite).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { seedAcme } from "../fixtures/example/seed.ts";
import { visibleRows } from "../src/commands/data.ts";

const TEST_DB = "acme_enforce";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  await seedAcme(TEST_DB);
} else {
  console.log(`[enforcement] SurrealDB unavailable at ${cfg.url} — skipping. (bun run db:up)`);
}

const clientsFor = (u: string) => visibleRows("acme", u, "client", TEST_DB);
const accounts = (rows: Record<string, unknown>[]) => rows.map((r) => r.account as string).sort();

(dbUp ? describe : describe.skip)("enforcement (Surreal record-perm, generation→enforcement)", () => {
  test("cleo @ north sees ONLY north", async () => {
    expect(accounts(await clientsFor("cleo"))).toEqual(["north"]);
  });

  test("ben (content) sees NO client at all — the adversarial case", async () => {
    // even handed the connection, the backend bars him: 0 rows.
    expect(await clientsFor("ben")).toEqual([]);
  });

  test("ada (owner @ root, unscoped) sees ALL — via lineage", async () => {
    expect(accounts(await clientsFor("ada"))).toEqual(["east", "north", "west"]);
  });

  test("root (the build/auth service) BYPASSES — sees all", async () => {
    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[{ account: string }[]]>("SELECT account FROM client");
      expect(rows.map((r) => r.account).sort()).toEqual(["east", "north", "west"]);
    } finally {
      await db.close();
    }
  });

  test("UNSCOPED bucket (proposals) — the second generated template, live", async () => {
    // proposals has NO rowScope: only the owner-lineage path grants access.
    const db = await connectSurreal(cfg);
    try {
      await db.query('DELETE proposal; CREATE proposal:p1 SET title = "big deal"');
    } finally {
      await db.close();
    }
    // ada: unscoped @acme, acme ∈ sales.lineage → sees it
    expect((await visibleRows("acme", "ada", "proposal", TEST_DB)).length).toBe(1);
    // cleo: only a SCOPED assignment (delivery@north) — no unscoped path → zero
    expect(await visibleRows("acme", "cleo", "proposal", TEST_DB)).toEqual([]);
  });
});
