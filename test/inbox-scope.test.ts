// ADR 0014 — scoped frictions: the inbox permission model. Proves against live
// Surreal: (1) members read/resolve within the REAL reach of their lineage
// (scope.lineage dot-access — the decision_log mechanism); (2) scope = NONE is the
// root queue, invisible to every member (pre-0014 behavior preserved); (3) content
// is immutable post-create (VALUE $before OR $value — pinned as an upgrade canary,
// like the 0013 asymmetries); (4) update permission checks the NEW row too, so a
// member re-scopes only within reach — escalation beyond happens at CREATE or via
// root; (5) a deleted purpose's frictions fall to the nearest surviving ancestor.
//
// Fixture reach: ada = owner acme(root)+content · ben = member content ·
// cleo = member delivery(north). lineage(content) = [acme, growth, content].

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import type { Surreal } from "surrealdb";
import { surrealConfig, surrealReachable, connectSurreal, connectWithToken, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { listInbox, drainInbox, rescopeInbox } from "../src/commands/inbox.ts";
import { applyGraph } from "../src/graph/apply.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";

const TEST_DB = "acme_scope_test";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);

(dbUp ? describe : describe.skip)("scoped inbox (ADR 0014)", () => {
  let root: Surreal;
  const as = (u: string) => connectWithToken(cfg, mintIdentityJwt(cfg, u));

  beforeAll(async () => {
    await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
    root = await connectSurreal(cfg);
    await root.query("DELETE inbox");
  });

  afterAll(async () => {
    await root.query(`REMOVE DATABASE \`${TEST_DB}\``);
    await root.close();
  });

  async function createAs(user: string, sql: string): Promise<unknown[]> {
    const db = await as(user);
    try {
      const [rows] = await db.query<[unknown[]]>(sql);
      return rows;
    } finally {
      await db.close();
    }
  }
  async function seenBy(user: string): Promise<string[]> {
    const db = await as(user);
    try {
      const [rows] = await db.query<[{ text: string }[]]>("SELECT text FROM inbox ORDER BY text");
      return rows.map((r) => r.text);
    } finally {
      await db.close();
    }
  }

  test("visibility matrix: scope reach by REAL lineage; NONE = root-only queue", async () => {
    await createAs("ben", `CREATE inbox SET kind = "friction", text = "f-content", origin = "content", scope = purpose:content`);
    await createAs("cleo", `CREATE inbox SET kind = "friction", text = "f-delivery", scope = purpose:delivery`);
    // unscoped → root queue; return is select-filtered ([]) but the row LANDS
    expect(await createAs("ben", `CREATE inbox SET kind = "friction", text = "f-root"`)).toEqual([]);

    expect(await seenBy("ben")).toEqual(["f-content"]);
    expect(await seenBy("cleo")).toEqual(["f-delivery"]);
    expect(await seenBy("ada")).toEqual(["f-content", "f-delivery"]); // owner of the ROOT purpose reaches every scoped row
    // root (governance) sees all three, scope rendered (null = root queue)
    const all = await listInbox("acme", { surrealDb: TEST_DB });
    expect(all.map((e) => [e.text, e.scope]).sort()).toEqual([
      ["f-content", "content"],
      ["f-delivery", "delivery"],
      ["f-root", null],
    ]);
  });

  test("canary: content is immutable post-create (VALUE $before OR $value); stamps stick", async () => {
    const ben = await as("ben");
    try {
      const [rows] = await ben.query<[{ text: string; origin: string; at: unknown; drained: unknown; resolved_through: string }[]]>(
        `UPDATE inbox SET text = "FORGED", origin = "FORGED", at = d"2020-01-01T00:00:00Z",
           drained = time::now(), resolved_through = "PR #9"
         WHERE scope = purpose:content
         RETURN text, origin, at, drained, resolved_through`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.text).toBe("f-content");
      expect(rows[0]!.origin).toBe("content");
      expect(String(rows[0]!.at)).not.toContain("2020"); // at is server-stamped, not backdatable
      expect(rows[0]!.resolved_through).toBe("PR #9");
      expect(rows[0]!.drained).toBeTruthy();
    } finally {
      await ben.close();
    }
  });

  test("out-of-scope update is a silent no-op; root drain still catches every undrained row", async () => {
    const cleo = await as("cleo");
    try {
      const [rows] = await cleo.query<[unknown[]]>(`UPDATE inbox SET drained = time::now() WHERE text = "f-content"`);
      expect(rows).toEqual([]); // not hers — nothing matched, nothing leaked
    } finally {
      await cleo.close();
    }
    // f-delivery (cleo's, undrained) + f-root (queue) — f-content was locally resolved above
    const stamped = await drainInbox("acme", { surrealDb: TEST_DB });
    expect(stamped.length).toBe(2);
  });

  test("escalation at CREATE reaches beyond the writer; member re-scope works within reach", async () => {
    // ben scopes to growth (his purpose's PARENT — beyond his reach): lands, invisible to him
    expect(await createAs("ben", `CREATE inbox SET kind = "friction", text = "f-escalada", scope = purpose:growth`)).toEqual([]);
    expect(await seenBy("ben")).toEqual(["f-content"]);
    // ada (root reach) sees it and hands it down to content — ben regains sight
    const ada = await as("ada");
    try {
      const [moved] = await ada.query<[unknown[]]>(`UPDATE inbox SET scope = purpose:content WHERE text = "f-escalada"`);
      expect((moved as unknown[]).length).toBe(1);
    } finally {
      await ada.close();
    }
    expect((await seenBy("ben")).sort()).toEqual(["f-content", "f-escalada"]);
    // canary: a member CANNOT re-scope beyond reach (update perm checks the NEW row too)
    const ben = await as("ben");
    try {
      const [rows] = await ben.query<[unknown[]]>(`UPDATE inbox SET scope = purpose:growth WHERE text = "f-escalada"`);
      expect(rows).toEqual([]);
    } finally {
      await ben.close();
    }
    expect((await seenBy("ben")).sort()).toEqual(["f-content", "f-escalada"]); // unchanged
  });

  test("journals born scopeless go to the root queue — invisible to the local reach", async () => {
    await createAs("ben", `CREATE inbox SET kind = "journal", text = "j-session"`);
    expect(await seenBy("ben")).not.toContain("j-session");
    const all = await listInbox("acme", { all: true, surrealDb: TEST_DB });
    expect(all.find((e) => e.text === "j-session")).toMatchObject({ kind: "journal", scope: null });
  });

  test("root triage (rescopeInbox): queue → purpose hands it to the local reach, and back", async () => {
    await createAs("cleo", `CREATE inbox SET kind = "friction", text = "f-triage"`); // root queue
    expect(await seenBy("ben")).not.toContain("f-triage");
    const id = (await listInbox("acme", { all: true, surrealDb: TEST_DB })).find((e) => e.text === "f-triage")!.id;

    await rescopeInbox("acme", id, "content", { surrealDb: TEST_DB });
    expect(await seenBy("ben")).toContain("f-triage");

    await rescopeInbox("acme", id, "root", { surrealDb: TEST_DB }); // fishing it back up
    expect(await seenBy("ben")).not.toContain("f-triage");

    await expect(rescopeInbox("acme", id, "nope", { surrealDb: TEST_DB })).rejects.toThrow(/unknown purpose/);
    await expect(rescopeInbox("acme", "missing-id", "content", { surrealDb: TEST_DB })).rejects.toThrow(/not found/);
  });

  test("deleting a purpose re-scopes its frictions to the nearest surviving ancestor", async () => {
    // remove `delivery` from the graph: cleo moves to services, its bucket goes too
    const def = structuredClone(exampleDefinition);
    def.purposes = def.purposes.filter((p) => p.id !== "delivery");
    def.buckets = def.buckets.filter((b) => b.owner !== "delivery");
    delete def.agentByPurpose.delivery;
    const users = structuredClone(exampleUsers);
    users.cleo!.assignments = [{ purpose: "services", role: "member" as const }];

    const report = await applyGraph(root, { ...def, namespace: TEST_DB }, users, { confirmDeletes: true });
    expect(report.status).toBe("applied");

    const all = await listInbox("acme", { all: true, surrealDb: TEST_DB });
    expect(all.find((e) => e.text === "f-delivery")!.scope).toBe("services"); // delivery's parent
  });
});
