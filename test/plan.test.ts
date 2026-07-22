// Tests for `deploy plan` core (roadmap I.3). The pure diff/validate is exercised
// with synthetic states (no DB); the integration migrates the acme example and asserts
// a freshly-migrated DB has ZERO drift against graph.yaml (the round-trip is faithful).
// The gh existence check is NOT exercised here (network/best-effort).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { desiredState, planGraph, planIsEmpty, validateGraph, type GraphState, type Edge } from "../src/graph/plan.ts";
import { loadDecisions, loadGraphFile } from "../src/graph/load-graph.ts";
import { reset } from "../src/commands/reset.ts";
import { SurrealProvider, surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import type { Definition, User } from "../src/provider/types.ts";

const YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");

// ─── validation (a) ──────────────────────────────────────────────────────

describe("validateGraph", () => {
  test("the example graph.yaml is valid", () => {
    const { definition, users } = loadGraphFile(YAML);
    expect(validateGraph(definition, users)).toEqual([]);
  });

  test("catches dangling refs and the owner⇒unscoped invariant", () => {
    const def: Definition = {
      namespace: "t",
      ambient: { skills: ["ghost"] },
      purposes: [{ id: "root", parent: null, reason: "r", decides: [], owns: ["nope"], reads: [], skills: [], tools: [] }],
      buckets: [{ id: "b", backend: "surreal", owner: "missing", sens: "low" }],
      toolCatalog: {},
      skillCatalog: {},
      agentByPurpose: {},
      marketplaces: {},
    };
    const users: Record<string, User> = {
      ana: { id: "ana", name: "Ana", assignments: [{ purpose: "ghostpurpose", role: "member" }, { purpose: "root", scope: "x", role: "owner" }] },
    };
    const errors = validateGraph(def, users);
    expect(errors.some((e) => e.includes(`owns bucket "nope"`))).toBe(true);
    expect(errors.some((e) => e.includes(`owner "missing"`))).toBe(true);
    expect(errors.some((e) => e.includes(`ambient: skill "ghost"`))).toBe(true);
    expect(errors.some((e) => e.includes(`purpose "ghostpurpose"`))).toBe(true);
    expect(errors.some((e) => e.includes("owner has no scope"))).toBe(true);
  });

  test("surreal-bucket invariants: safe identifiers, unique tables, reserved names (ADR 0011)", () => {
    const def: Definition = {
      namespace: "t",
      ambient: { skills: [] },
      purposes: [{ id: "p", parent: null, reason: "r", decides: [], owns: [], reads: [], skills: [], tools: [] }],
      buckets: [
        { id: "a", backend: "surreal", tables: ["bad-table"], owner: "p", rowScope: "a b", sens: "high" },
        { id: "b1", backend: "surreal", tables: ["shared"], owner: "p", sens: "low" },
        { id: "b2", backend: "surreal", tables: ["shared", "user"], owner: "p", sens: "low" },
        { id: "kb-ok", backend: "okf-repo", repo: "o/r", owner: "p", sens: "low" }, // okf: hyphens fine, no table rules
      ],
      toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {},
    };
    const errors = validateGraph(def, {});
    expect(errors).toContain(`bucket "a": table "bad-table" is not a safe identifier (letters, digits, _)`);
    expect(errors).toContain(`bucket "a": rowScope "a b" is not a safe identifier (letters, digits, _)`);
    expect(errors).toContain(`table "shared" is declared by two buckets ("b1" and "b2") — one table, one bucket`);
    expect(errors).toContain(`bucket "b2": table "user" is reserved (engine table)`);
    expect(errors.some((e) => e.includes(`"kb-ok"`))).toBe(false);
  });

  test("decision-domain invariants: safe slugs, one domain one purpose (ADR 0013)", () => {
    const def: Definition = {
      namespace: "t",
      ambient: { skills: [] },
      purposes: [
        { id: "p1", parent: null, reason: "r", decides: ["pricing", "bad slug!"], owns: [], reads: [], skills: [], tools: [] },
        { id: "p2", parent: "p1", reason: "r", decides: ["pricing", "discount-policy"], owns: [], reads: [], skills: [], tools: [] },
      ],
      buckets: [],
      toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {},
    };
    const errors = validateGraph(def, {});
    expect(errors).toContain(`purpose "p1": decision domain "bad slug!" is not a safe slug (letters, digits, _ or -)`);
    expect(errors).toContain(`decision domain "pricing" is declared by two purposes ("p1" and "p2") — one domain, one purpose`);
    expect(errors.some((e) => e.includes("discount-policy"))).toBe(false); // hyphens legal
  });

  test("decision records: domain must be declared, supersedes must resolve", () => {
    const def: Definition = {
      namespace: "t",
      ambient: { skills: [] },
      purposes: [{ id: "p", parent: null, reason: "r", decides: ["pricing"], owns: [], reads: [], skills: [], tools: [] }],
      buckets: [],
      toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {},
      decisionCatalog: {
        "pricing/0001-floor": { domain: "pricing", status: "accepted", title: "t", content: "c" },
        "ghost/0001-x": { domain: "ghost", status: "proposed", title: "t", content: "c" },
        "pricing/0002-new": { domain: "pricing", status: "accepted", title: "t", content: "c", supersedes: "pricing/0000-nope" },
      },
    };
    const errors = validateGraph(def, {});
    expect(errors).toContain(`decision "ghost/0001-x": domain "ghost" is not declared by any purpose (decides:)`);
    expect(errors).toContain(`decision "pricing/0002-new": supersedes "pricing/0000-nope" does not exist`);
    expect(errors.some((e) => e.includes("0001-floor"))).toBe(false);
  });
});

// ─── decisions/ loader (ADR 0013) ────────────────────────────────────────

describe("loadDecisions", () => {
  test("reads the fixture decisions/ — frontmatter + verbatim body", () => {
    const decisions = loadDecisions(join(import.meta.dir, "../fixtures/example"));
    const floor = decisions["pricing/0001-enterprise-floor"]!;
    expect(floor.domain).toBe("pricing");
    expect(floor.status).toBe("accepted");
    expect(floor.title).toBe("Enterprise tier price floor");
    expect(floor.at).toBe(new Date("2026-07-01").toISOString());
    expect(floor.content.startsWith("# Enterprise tier price floor")).toBe(true);
    expect(decisions["editorial/0001-voice"]!.status).toBe("proposed");
  });

  test("an ACCEPTED record with edited content raises a plan warning", () => {
    const rec = { domain: "pricing", status: "accepted" as const, title: "t", content: "old body" };
    const mk = (content: string): GraphState => ({
      def: { namespace: "t", ambient: { skills: [] }, purposes: [], buckets: [], toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {}, decisionCatalog: { "pricing/0001-x": { ...rec, content } } },
      users: {}, edges: [],
    });
    const plan = planGraph(mk("NEW body"), mk("old body"));
    expect(plan.warnings).toEqual([`decision "pricing/0001-x" is accepted (immutable) — supersede it instead of editing`]);
    expect(plan.update.length).toBe(1); // the content hash change itself
  });
});

// ─── plan (b) ────────────────────────────────────────────────────────────

function state(def: Partial<Definition>, edges: Edge[] = []): GraphState {
  return {
    def: { namespace: "t", ambient: { skills: [] }, purposes: [], buckets: [], toolCatalog: {}, skillCatalog: {}, agentByPurpose: {}, marketplaces: {}, ...def },
    users: {},
    edges,
  };
}

describe("planGraph", () => {
  test("no changes → empty plan", () => {
    const s = state({ purposes: [{ id: "a", parent: null, reason: "r", decides: [], owns: [], reads: [], skills: [], tools: [] }] });
    expect(planIsEmpty(planGraph(s, s))).toBe(true);
  });

  test("create / delete by presence", () => {
    const desired = state({ purposes: [{ id: "a", parent: null, reason: "r", decides: [], owns: [], reads: [], skills: [], tools: [] }] });
    const current = state({ purposes: [{ id: "b", parent: null, reason: "r", decides: [], owns: [], reads: [], skills: [], tools: [] }] });
    const plan = planGraph(desired, current);
    expect(plan.create).toEqual([{ kind: "purpose", id: "a" }]);
    expect(plan.delete).toEqual([{ kind: "purpose", id: "b" }]);
  });

  test("field-level update: scalar + set-diff (order-blind)", () => {
    const mk = (reason: string, decides: string[]) => state({ purposes: [{ id: "a", parent: null, reason, decides, owns: [], reads: [], skills: [], tools: [] }] });
    const plan = planGraph(mk("new", ["x", "z"]), mk("old", ["z", "y"]));
    expect(plan.update).toHaveLength(1);
    const u = plan.update[0]!;
    expect(u.changes.find((c) => c.field === "reason")).toEqual({ field: "reason", from: "old", to: "new" });
    expect(u.changes.find((c) => c.field === "decides")).toEqual({ field: "decides", added: ["x"], removed: ["y"] });
  });

  test("set diff ignores order (no false drift)", () => {
    const mk = (tools: string[]) => state({ purposes: [{ id: "a", parent: null, reason: "r", decides: [], owns: [], reads: [], skills: [], tools }] });
    expect(planIsEmpty(planGraph(mk(["a", "b"]), mk(["b", "a"])))).toBe(true);
  });

  test("responsible edge: create, delete, and role update keyed by (user,purpose,scope)", () => {
    const desired = state({}, [{ user: "u", purpose: "p", role: "owner" }, { user: "u", purpose: "q", scope: "nord", role: "member" }]);
    const current = state({}, [{ user: "u", purpose: "p", role: "member" }, { user: "u", purpose: "r", role: "member" }]);
    const plan = planGraph(desired, current);
    expect(plan.create).toContainEqual({ kind: "responsible", id: "u→q[nord]" });
    expect(plan.delete).toContainEqual({ kind: "responsible", id: "u→r" });
    expect(plan.update).toContainEqual({ kind: "responsible", id: "u→p", changes: [{ field: "role", from: "member", to: "owner" }] });
  });
});

// ─── integration: fresh migrate has zero drift ───────────────────────────

const TEST_DB = "acme_plan_test";
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);
if (dbUp) await reset({ graph: YAML, surrealDb: TEST_DB });

(dbUp ? describe : describe.skip)("deploy plan (surreal)", () => {
  test("a freshly-migrated DB is in sync with graph.yaml (zero drift)", async () => {
    const { definition, users } = loadGraphFile(YAML);
    const desired = desiredState(definition, users);

    const db = await connectSurreal(cfg);
    try {
      const provider = new SurrealProvider(db, "acme");
      const def = await provider.getDefinition();
      const asg = await provider.listAssignments();
      const cUsers: GraphState["users"] = {};
      const edges: Edge[] = [];
      for (const r of asg) {
        cUsers[r.user.id] = { name: r.user.name, ...(r.user.github !== undefined ? { github: r.user.github } : {}) };
        edges.push({ user: r.user.id, purpose: r.purpose, ...(r.scope !== undefined ? { scope: r.scope } : {}), role: r.role });
      }
      const plan = planGraph(desired, { def, users: cUsers, edges });
      if (!planIsEmpty(plan)) console.error("unexpected drift:", JSON.stringify(plan, null, 2));
      expect(planIsEmpty(plan)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
