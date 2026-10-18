import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { type Surreal } from "surrealdb";
import { readCurrentState, applyGraph, emptyDefinition } from "../src/graph/apply.ts";
import { planGraph, desiredState } from "../src/graph/plan.ts";
import { surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";

const cfg = surrealConfig("acme", { db: "acme_state_inspection" });
const up = await surrealReachable(cfg);
(up ? describe : describe.skip)("administrative state inspection", () => {
  let db: Surreal;
  beforeAll(async () => { db = await connectSurreal(cfg); });
  beforeEach(async () => {
    await db.query("REMOVE DATABASE IF EXISTS acme_state_inspection");
    await db.use({ namespace: cfg.ns, database: cfg.db });
  });
  afterAll(async () => { if (db) { await db.query("REMOVE DATABASE acme_state_inspection"); await db.close(); } });
  test("absent database and schema-only database are all-create, then converge is empty", async () => {
    const desired = desiredState(exampleDefinition, exampleUsers);
    const virgin = planGraph(desired, await readCurrentState(db, "acme"));
    expect(virgin.create).toContainEqual({ kind: "config", id: "ambient" });
    expect(virgin.update).toEqual([]);
    await db.query("DEFINE TABLE config SCHEMALESS");
    expect((await readCurrentState(db, "acme")).configExists).toBe(false);
    const secret = process.env.MEROVINGIAN_JWT_SECRET;
    try {
      process.env.MEROVINGIAN_JWT_SECRET = "short-test-key";
      await expect(applyGraph(db, exampleDefinition, exampleUsers)).rejects.toThrow(/at least 32/);
      const [info] = await db.query<[{ accesses: Record<string, unknown> }]>("INFO FOR DB");
      expect(info.accesses.identity).toBeUndefined();
    } finally {
      if (secret === undefined) delete process.env.MEROVINGIAN_JWT_SECRET;
      else process.env.MEROVINGIAN_JWT_SECRET = secret;
    }
    await applyGraph(db, exampleDefinition, exampleUsers);
    expect(planGraph(desired, await readCurrentState(db, "acme"))).toEqual({ create: [], update: [], delete: [], warnings: [] });
  });
  test("missing table on an existing graph is diagnosed, never an all-create plan", async () => {
    await applyGraph(db, exampleDefinition, exampleUsers);
    await db.query("REMOVE TABLE agent");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/missing tables agent/);
    await applyGraph(db, exampleDefinition, exampleUsers);
    expect((await readCurrentState(db, "acme")).configExists).toBe(true);
  });
  test("missing config with surviving graph data refuses to infer emptiness", async () => {
    await applyGraph(db, exampleDefinition, exampleUsers);
    await db.query("DELETE config");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/config is missing but \w+ contains records/);
  });
  test("interrupted first provisioning retains config and can be retried", async () => {
    let writes = 0;
    const interrupted = new Proxy(db, {
      get(target, key) {
        if (key === "upsert") return (...args: Parameters<Surreal["upsert"]>) => {
          if (++writes === 2) return { content: async () => { throw new Error("synthetic interruption"); } };
          return target.upsert(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(applyGraph(interrupted, exampleDefinition, exampleUsers)).rejects.toThrow(/synthetic interruption/);
    expect((await readCurrentState(db, "acme")).configExists).toBe(true);
    await applyGraph(db, exampleDefinition, exampleUsers);
    expect(planGraph(desiredState(exampleDefinition, exampleUsers), await readCurrentState(db, "acme"))).toEqual({ create: [], update: [], delete: [], warnings: [] });
  });
  test("duplicate or wrong-tenant config records block planning", async () => {
    await applyGraph(db, exampleDefinition, exampleUsers);
    await db.query("CREATE config:other CONTENT { ambient: [] }");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/exactly one configuration/);
    await db.query("DELETE config:acme");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/exactly one configuration/);
  });
  test("business data without config is not a virgin database", async () => {
    await db.query("DEFINE TABLE `business-data` SCHEMALESS; CREATE `business-data`:old CONTENT { text: 'synthetic business record' }");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/business-data contains records/);
  });
  test("historical data alone is not a virgin database", async () => {
    await db.query("DEFINE TABLE inbox SCHEMALESS; CREATE inbox:old CONTENT { text: 'synthetic history' }");
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/inbox contains records/);
  });
});

describe("state inspection does not swallow failed reads", () => {
  test("an arbitrary does-not-exist error is propagated", async () => {
    const error = new Error("network proxy does not exist");
    const db = { query: async () => { throw error; } } as unknown as Surreal;
    await expect(readCurrentState(db, "acme")).rejects.toBe(error);
  });
  test("denied inventory never becomes empty state", async () => {
    const db = { query: async () => [undefined] } as unknown as Surreal;
    await expect(readCurrentState(db, "acme")).rejects.toThrow(/Unable to inspect/);
  });
  test("empty ambient content still needs creation; existing empty config does not", () => {
    const desired = desiredState(emptyDefinition("acme"), {});
    expect(planGraph(desired, { ...desired, configExists: false }).create).toContainEqual({ kind: "config", id: "ambient" });
    expect(planGraph(desired, { ...desired, configExists: true }).create).toEqual([]);
    desired.def.ambient.instructions = "new instructions";
    const current = desiredState(emptyDefinition("acme"), {});
    expect(planGraph(desired, { ...current, configExists: true }).update[0]?.kind).toBe("config");
  });
});
