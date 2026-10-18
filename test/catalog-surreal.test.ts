import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Surreal } from "surrealdb";
import { applyGraph, readCurrentState } from "../src/graph/apply.ts";
import { desiredState, planGraph } from "../src/graph/plan.ts";
import { surrealConfig, surrealReachable, connectSurreal, connectAsPassword } from "../src/provider/surreal.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";
import { readCatalog } from "../src/catalog/session.ts";
import { resolveCatalog } from "../src/catalog/catalog.ts";

const cfg = surrealConfig("acme_catalog_test");
const available = await surrealReachable(cfg);
const definition = { ...structuredClone(exampleDefinition), namespace: cfg.db };
const users = structuredClone(exampleUsers);
users.cleo!.email = "cleo@example.com";
users.cleo!.slackId = "UEXAMPLE";
users.ada!.journalAdmin = true;
const personal = { cfg: { ...cfg, username: "", password: "" }, user: "cleo", password: "catalog-test-password" };

(available ? describe : describe.skip)("catalog with password-scoped SurrealDB", () => {
  let root: Surreal;
  beforeAll(async () => {
    root = await connectSurreal(cfg);
    await applyGraph(root, definition, users, { reset: true });
    await root.query("UPSERT credential:cleo SET pass = crypto::argon2::generate($pass)", { pass: personal.password });
  });
  afterAll(async () => { await root.query("REMOVE DATABASE acme_catalog_test"); await root.close(); });

  test("scoped database and pure graph produce the same public catalog", async () => {
    expect(await readCatalog(personal)).toEqual(resolveCatalog(definition, users.cleo!));
  });
  test("administrative profile fields roundtrip without deploy drift", async () => {
    const current = await readCurrentState(root, cfg.db);
    const diff = planGraph(desiredState(definition, users), current);
    expect(diff.update.filter(r => r.kind === "user")).toEqual([]);
  });
  test("a member cannot change their GitHub identity or read another profile", async () => {
    const db = await connectAsPassword(personal.cfg, personal.user, personal.password);
    try {
      await db.query("UPDATE user:cleo SET github = 'attacker'");
      const [other] = await db.query<[unknown[]]>("SELECT * FROM user:ada");
      expect(other).toEqual([]);
      expect((await readCatalog(personal)).identity.github).toBe(users.cleo!.github);
    } finally { await db.close(); }
  });
  test("wrong password and different database never produce an empty valid catalog", async () => {
    await expect(readCatalog({ ...personal, password: "wrong-test-password" })).rejects.toThrow("Identity connection failed");
    await expect(readCatalog({ ...personal, cfg: { ...personal.cfg, db: "acme_catalog_absent" } })).rejects.toThrow("Identity connection failed");
  });
});
