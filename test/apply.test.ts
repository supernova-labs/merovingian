// Tests for `deploy apply` / applyGraph (roadmap I.4). These exercise the paths the
// existing suite CANNOT see: lineage cascade (write-only field), config singleton id,
// edge scope=NONE deletion, agent clearing, idempotency, the atomic referrer block,
// subtree delete, data-safety, and the --yes gate. Surreal-only (own db, skip if down).
// Runs against the generic `acme` example tenant.

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import { applyGraph } from "../src/graph/apply.ts";
import { seedInto } from "../fixtures/example/seed.ts";
import { surrealConfig, surrealReachable, connectSurreal, connectAs } from "../src/provider/surreal.ts";
import { exampleDefinition } from "../fixtures/example/graph.ts";
import { exampleUsers } from "../fixtures/example/graph.ts";
import type { Definition, User } from "../src/provider/types.ts";

const TEST_DB = "acme_apply_test";
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);

const clone = () => ({
  def: structuredClone(exampleDefinition) as Definition,
  users: structuredClone(exampleUsers) as Record<string, User>,
});

async function lineageIds(db: Surreal, pid: string): Promise<string[]> {
  const [rows] = await db.query<[{ lineage: RecordId[] }[]]>("SELECT lineage FROM type::record('purpose', $p)", { p: pid });
  return (rows[0]?.lineage ?? []).map((r) => String(r.id));
}
async function exists(db: Surreal, kind: string, id: string): Promise<boolean> {
  const [rows] = await db.query<[unknown[]]>("SELECT id FROM type::record($k, $id)", { k: kind, id });
  return rows.length > 0;
}
async function edgeIds(db: Surreal): Promise<string[]> {
  const [rows] = await db.query<[{ id: RecordId }[]]>("SELECT id FROM responsible");
  return rows.map((r) => String(r.id)).sort();
}

(dbUp ? describe : describe.skip)("applyGraph (surreal)", () => {
  let db: Surreal;
  beforeAll(async () => {
    db = await connectSurreal(cfg);
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    // reset to a clean base: applyGraph(reset) ensures schema + wipes structural;
    // then clear the runtime tables (now guaranteed to exist) for test isolation.
    const { def, users } = clone();
    await applyGraph(db, def, users, { reset: true });
    await db.query("DELETE inbox; DELETE client;");
  });

  test("T.1 lineage cascade — re-parenting an ancestor rewrites descendants' lineage", async () => {
    const { def, users } = clone();
    // services: acme → growth. delivery (child of services) lineage must follow.
    def.purposes.find((p) => p.id === "services")!.parent = "growth";
    const report = await applyGraph(db, def, users, { confirmDeletes: true });
    expect(report.status).toBe("applied");
    expect(await lineageIds(db, "services")).toEqual(["services", "growth", "acme"]);
    expect(await lineageIds(db, "delivery")).toEqual(["delivery", "services", "growth", "acme"]);
  });

  test("T.2 config is a single row keyed on the namespace", async () => {
    const [rows] = await db.query<[{ id: string }[]]>("SELECT record::id(id) AS id FROM config");
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("acme");
  });

  test("T.3 edge scope=NONE — deleting one edge leaves the same-user/purpose sibling", async () => {
    // start: tester holds BOTH an unscoped and a north-scoped member edge to delivery
    const base = clone();
    base.users.tester = { id: "tester", name: "Tester", assignments: [
      { purpose: "delivery", role: "member" },
      { purpose: "delivery", scope: "north", role: "member" },
    ] };
    await applyGraph(db, base.def, base.users, { reset: true });

    const scopesOf = async (): Promise<string[]> => {
      const [rows] = await db.query<[{ scope: string | null }[]]>(
        "SELECT scope FROM responsible WHERE in = type::record('user','tester')",
      );
      return rows.map((r) => r.scope ?? "∅").sort();
    };
    expect(await scopesOf()).toEqual(["north", "∅"]);

    // desired: drop the SCOPED edge → deletes with scope=$s, unscoped (NONE) survives
    const d1 = clone();
    d1.users.tester = { id: "tester", name: "Tester", assignments: [{ purpose: "delivery", role: "member" }] };
    expect((await applyGraph(db, d1.def, d1.users, { confirmDeletes: true })).status).toBe("applied");
    expect(await scopesOf()).toEqual(["∅"]);

    // desired: drop the UNSCOPED edge → deletes with scope=NONE, scoped survives
    const d2 = clone();
    d2.users.tester = { id: "tester", name: "Tester", assignments: [{ purpose: "delivery", scope: "north", role: "member" }] };
    expect((await applyGraph(db, d2.def, d2.users, { confirmDeletes: true })).status).toBe("applied");
    expect(await scopesOf()).toEqual(["north"]);
  });

  test("T.4 agent clear — removing a purpose's agent nulls the ref AND deletes the orphaned content", async () => {
    const { def, users } = clone();
    delete def.agentByPurpose.method; // method's agent is library-sourced → agent:method orphans
    const report = await applyGraph(db, def, users, { confirmDeletes: true });
    expect(report.status).toBe("applied");
    const [rows] = await db.query<[{ a: string | null }[]]>("SELECT agent AS a FROM purpose:method");
    expect(rows[0]!.a ?? null).toBeNull();
    const [agents] = await db.query<[unknown[]]>("SELECT id FROM agent:method");
    expect(agents.length).toBe(0);
  });

  test("T.4b library content update converges (skill files + agent content)", async () => {
    const { def, users } = clone();
    const journal = def.skillCatalog.journal!;
    if (journal.source !== "library") throw new Error("fixture drift: journal must be library");
    journal.files["SKILL.md"] = "# journal v2\nnew method";
    const agent = def.agentByPurpose.method!;
    if (agent.source !== "library") throw new Error("fixture drift: method agent must be library");
    agent.content = "# method v2";
    const report = await applyGraph(db, def, users, {});
    expect(report.status).toBe("applied");
    // hash-scalar updates in the plan, real content in the db
    expect(report.plan.update.map((u) => `${u.kind}:${u.id}`).sort()).toEqual(["agent:method", "skill:journal"]);
    const [skills] = await db.query<[{ files: Record<string, string> }[]]>("SELECT files FROM skill:journal");
    expect(skills[0]!.files["SKILL.md"]).toBe("# journal v2\nnew method");
    const [agents] = await db.query<[{ content: string }[]]>("SELECT content FROM agent:method");
    expect(agents[0]!.content).toBe("# method v2");
  });

  test("T.5 idempotency — a no-op apply changes zero edge records", async () => {
    const before = await edgeIds(db);
    const { def, users } = clone();
    const report = await applyGraph(db, def, users, {});
    expect(report.status).toBe("applied");
    expect(report.applied).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(await edgeIds(db)).toEqual(before); // relate mints new ids → any churn would differ
  });

  test("T.6 atomic block — a user with a live inbox row can't be deleted; nothing applies", async () => {
    // cleo appends an inbox row (stamped user:cleo by VALUE $auth)
    const rdb = await connectAs(cfg, "cleo");
    try {
      await rdb.query('CREATE inbox SET kind = "journal", text = "need to stay"');
    } finally {
      await rdb.close();
    }

    // desired removes cleo AND adds a new purpose — the block must abort BOTH
    const { def, users } = clone();
    delete users.cleo;
    def.purposes.push({ id: "testblock", parent: "acme", reason: "x", decides: [], owns: [], reads: [], skills: [], tools: [] });

    const report = await applyGraph(db, def, users, { confirmDeletes: true });
    expect(report.status).toBe("blocked");
    expect(report.blocked?.some((b) => b.kind === "user" && b.id === "cleo")).toBe(true);
    expect(await exists(db, "user", "cleo")).toBe(true); // survived
    expect(await exists(db, "purpose", "testblock")).toBe(false); // atomic: not created
  });

  test("T.7 subtree delete — remove a parent + children + their buckets + a user, no spurious block", async () => {
    const { def, users } = clone();
    // remove the whole `growth` subtree (growth + content + sales) and its buckets;
    // ben belonged only to content → remove him; ada keeps her root ownership.
    def.purposes = def.purposes.filter((p) => !["growth", "content", "sales"].includes(p.id));
    def.buckets = def.buckets.filter((b) => !["kb-company", "kb-content", "proposals"].includes(b.id));
    delete def.agentByPurpose.content;
    delete def.agentByPurpose.sales;
    // their decision domains (pricing, editorial) go too — records can't outlive the domain
    def.decisionCatalog = Object.fromEntries(
      Object.entries(def.decisionCatalog ?? {}).filter(([, d]) => !["pricing", "editorial"].includes(d.domain)),
    );
    delete users.ben;
    users.ada!.assignments = users.ada!.assignments.filter((a) => a.purpose !== "content");

    const report = await applyGraph(db, def, users, { confirmDeletes: true });
    expect(report.status).toBe("applied");
    for (const p of ["growth", "content", "sales"]) expect(await exists(db, "purpose", p)).toBe(false);
    for (const b of ["kb-company", "kb-content", "proposals"]) expect(await exists(db, "bucket", b)).toBe(false);
    expect(await exists(db, "user", "ben")).toBe(false);
  });

  test("T.8 data-safety + re-runnable — client rows survive a converge; second apply is a no-op", async () => {
    await seedInto(db);
    const { def, users } = clone();
    def.purposes.find((p) => p.id === "delivery")!.reason = "new text";
    const first = await applyGraph(db, def, users, {});
    expect(first.status).toBe("applied");
    const [clients] = await db.query<[unknown[]]>("SELECT account FROM client");
    expect(clients.length).toBe(3); // business data untouched

    const second = await applyGraph(db, def, users, {});
    expect(second.applied).toEqual({ created: 0, updated: 0, deleted: 0 });
  });

  test("T.9 --yes gate — a delete needs confirmation; nothing applies without it", async () => {
    const mk = () => {
      const { def, users } = clone();
      def.purposes = def.purposes.filter((p) => p.id !== "infra");
      def.buckets = def.buckets.filter((b) => b.id !== "kb-infra");
      delete def.agentByPurpose.infra;
      return { def, users };
    };
    const dry = mk();
    const r1 = await applyGraph(db, dry.def, dry.users, { confirmDeletes: false });
    expect(r1.status).toBe("needs-confirm");
    expect(await exists(db, "purpose", "infra")).toBe(true); // no writes

    const go = mk();
    const r2 = await applyGraph(db, go.def, go.users, { confirmDeletes: true });
    expect(r2.status).toBe("applied");
    expect(await exists(db, "purpose", "infra")).toBe(false);
  });
});
