// Golden suite: the build, run as each fake persona, must project the expected
// scoped workspace. Pure assertions on the Manifest — generation, not enforcement.
//
// The SAME assertions run against BOTH backends:
//   - stub    (always)
//   - surreal (only if a SurrealDB is reachable; migrated into a throwaway db)
// If both pass, the bet holds: the stub was not throwaway and the projection
// survives the swap StubProvider -> SurrealProvider.
//
// Runs against the generic `acme` example tenant (fixtures/example/graph.yaml).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";

import { LocalAccessService } from "../src/service/access.ts";
import { reset } from "../src/commands/reset.ts";
import { surrealConfig, surrealReachable, connectSurreal, SurrealProvider } from "../src/provider/surreal.ts";
import { stubProviderFor } from "../src/provider/stub.ts";
import { resolve } from "../src/projection/resolve.ts";
import type { Definition, User } from "../src/provider/types.ts";
import { renderGraph } from "../src/commands/graph.ts";
import type { Manifest } from "../src/projection/resolve.ts";

const STORE = "/STORE";
const TEST_DB = "acme_test";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const TENANT_INSTRUCTIONS = "Respect the authenticated identity and purpose boundaries. Keep changes reviewable.";

type GetManifest = (userId: string, purposes?: string[]) => Promise<Manifest>;

function getterFor(backend: "stub" | "surreal"): GetManifest {
  return async (userId, purposes) => {
    const db = backend === "surreal" ? await connectSurreal(surrealConfig("acme", {db: TEST_DB})) : undefined;
    const service = new LocalAccessService(db ? new SurrealProvider(db, "acme") : stubProviderFor("acme"), STORE);
    try {
      return await service.getManifest(userId, { purposes });
    } finally {
      await db?.close();
    }
  };
}

// ---- the shared assertions, parameterized over the backend's manifest getter ----
function runGolden(get: GetManifest) {
  describe("tenant-wide instructions", () => {
    test("are identical across identities and purpose-narrowed projections", async () => {
      const [root, member, narrowed] = await Promise.all([
        get("ada"),
        get("cleo"),
        get("ada", ["delivery"]),
      ]);
      expect(root.tenantInstructions).toBe(TENANT_INSTRUCTIONS);
      expect(member.tenantInstructions).toBe(TENANT_INSTRUCTIONS);
      expect(narrowed.tenantInstructions).toBe(TENANT_INSTRUCTIONS);
    });
  });

  describe("ada (owner @ root)", () => {
    test("sees the whole tree", async () => {
      const m = await get("ada");
      expect(m.visiblePurposes).toContain("acme");
      expect(m.visiblePurposes).toContain("content");
      expect(m.visiblePurposes).toContain("method");
      expect(m.visiblePurposes.length).toBe(9);
    });
    test("marks owned okf repos writable and read-only repos readable", async () => {
      const m = await get("ada");
      expect(Object.fromEntries(m.okf.map((o) => [o.bucket, o.writable]))).toEqual({
        "kb-company": true,
        "kb-content": true,
        "kb-infra": true,
        "kb-method": true,
        "kb-projects": true,
      });
    });
    test("mounts every okf repo and every surreal bucket", async () => {
      const m = await get("ada");
      expect(m.okf.map((o) => o.repo).sort()).toEqual(
        [
          "acme-labs/kb-company", "acme-labs/kb-content", "acme-labs/kb-infra",
          "acme-labs/kb-method", "acme-labs/kb-projects",
        ].sort(),
      );
      expect(m.surreal.map((s) => s.bucket).sort()).toEqual(["clients", "proposals"].sort());
    });
    test("root discovers purpose plugins and ambient journal", async () => {
      const m = await get("ada");
      expect(m.plugins).toEqual(expect.arrayContaining(["core@acme", "journal@acme", "compliance@guild", "sales-advisor@guild"]));
      expect(m.libraryAgents).toEqual([]);
      expect(m.librarySkills).toEqual([]);
    });
  });

  describe("ben (content)", () => {
    test("sees only content + what content reads", async () => {
      const m = await get("ben");
      expect(m.visiblePurposes).toEqual(["content"]);
      expect(m.okf.map((o) => o.repo).sort()).toEqual(
        ["acme-labs/kb-company", "acme-labs/kb-content", "acme-labs/kb-method"].sort(),
      );
      expect(Object.fromEntries(m.okf.map((o) => [o.bucket, o.writable]))).toEqual({
        "kb-company": false,
        "kb-content": true,
        "kb-method": false,
      });
    });
    test("sees NO sensitive surreal data", async () => {
      expect((await get("ben")).surreal).toEqual([]);
    });
    test("member gets only purpose and ambient plugins", async () => {
      const m = await get("ben");
      expect(m.plugins.sort()).toEqual(["content@acme", "edit@acme", "journal@acme", "write@acme"]);
      expect(Object.keys(m.marketplaces)).toEqual(["acme"]);
      expect(m.librarySkills).toEqual([]);
    });
  });

  describe("cleo (delivery @ north)", () => {
    test("sees delivery context, scoped to north, WITHOUT proposals", async () => {
      const m = await get("cleo");
      expect(m.visiblePurposes).toEqual(["delivery"]);
      expect(m.okf.map((o) => o.repo).sort()).toEqual(
        ["acme-labs/kb-method", "acme-labs/kb-projects"].sort(),
      );
      const clients = m.surreal.find((b) => b.bucket === "clients");
      expect(clients?.scope).toBe("account:north");
      expect(m.surreal.find((b) => b.bucket === "proposals")).toBeUndefined();
    });
    test("agent-only purpose discovers its plugin plus journal", async () => {
      expect((await get("cleo")).plugins.sort()).toEqual(["delivery@acme", "journal@acme"]);
    });
  });

  describe("owner vs member (accountability ≠ access)", () => {
    test("ada owns root AND content — two assignments, both owner", async () => {
      const m = await get("ada");
      // order is backend-dependent (Surreal doesn't guarantee edge order) → sort
      expect([...m.assignments].sort((a, b) => a.purpose.localeCompare(b.purpose))).toEqual([
        { purpose: "acme", role: "owner" },
        { purpose: "content", role: "owner" },
      ]);
    });
    test("ben is a MEMBER of content", async () => {
      const m = await get("ben");
      expect(m.assignments).toEqual([{ purpose: "content", role: "member" }]);
    });
    test("owner and member of content get the SAME content access", async () => {
      const owner = await get("ada");
      const member = await get("ben");
      expect(owner.visiblePurposes).toContain("content");
      expect(member.visiblePurposes).toContain("content");
      const contentRepo = "acme-labs/kb-content";
      expect(owner.okf.map((o) => o.repo)).toContain(contentRepo);
      expect(member.okf.map((o) => o.repo)).toContain(contentRepo);
    });
  });

  describe("--purposes narrows, can only subtract", () => {
    test("ada narrows to just the content subgraph", async () => {
      const m = await get("ada", ["content"]);
      expect(m.visiblePurposes).toEqual(["content"]);
      expect(m.surreal).toEqual([]);
      expect(m.plugins).toContain("content@acme");
      expect(m.plugins).not.toContain("sales-advisor@guild");
    });
    test("selecting an intermediate purpose pulls its descendants", async () => {
      const m = await get("ada", ["growth"]);
      expect(m.visiblePurposes.sort()).toEqual(["content", "growth", "sales"]);
    });
    test("a purpose outside entitlement throws (never expands)", async () => {
      expect(get("ben", ["method"])).rejects.toThrow(/is not in your access/);
    });
    test("empty --purposes = full entitlement", async () => {
      expect((await get("ben", [])).visiblePurposes).toEqual(["content"]);
    });
  });

  describe("graph render", () => {
    test("renders entitled purposes + scoped data", async () => {
      const out = renderGraph(await get("cleo"));
      expect(out).toContain("delivery");
      expect(out).toContain("clients(account:north)");
      expect(out).toContain("purposes:");
    });
  });

}

// ---- stub backend: always ----
describe("stub backend", () => {
  runGolden(getterFor("stub"));
});

// ---- surreal backend: only if a DB is reachable (migrated into a throwaway db) ----
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
} else {
  console.log(`[golden] SurrealDB unavailable at ${cfg.url} — skipping the surreal backend. (bun run db:up)`);
}
(dbUp ? describe : describe.skip)("surreal backend (path B)", () => {
  runGolden(getterFor("surreal"));
});

// ---- multi-marketplace capability (synthetic) ----
// The real fixture uses ONE marketplace for now. This proves the resolve mechanism
// still spans N marketplaces: a catalog where two skills live in different ones →
// enabledPlugins across both, and only the USED marketplaces are declared.
describe("multi-marketplace (synthetic def)", () => {
  const def: Definition = {
    namespace: "synthetic",
    ambient: { skills: [] },
    purposes: [
      { id: "p", parent: null, reason: "", decides: [], owns: [], reads: [], skills: ["a", "b"], tools: [] },
    ],
    buckets: [],
    toolCatalog: {},
    skillCatalog: {
      a: { source: "plugin", plugin: "plug-a", marketplace: "mkt-1" },
      b: { source: "plugin", plugin: "plug-b", marketplace: "mkt-2" },
    },
    agentByPurpose: {},
    marketplaces: {
      "mkt-1": {
        claude: { source: "org/mkt-1", name: "mkt-1" },
        codex: { source: "org/mkt-1", name: "mkt-1" },
      },
      "mkt-2": {
        claude: { source: "org/mkt-2", name: "mkt-2" },
        codex: { source: "org/mkt-2", name: "mkt-2" },
      },
      "mkt-unused": {
        claude: { source: "org/unused", name: "mkt-unused" },
        codex: { source: "org/unused", name: "mkt-unused" },
      },
    },
  };
  const user: User = { id: "u", name: "U", assignments: [{ purpose: "p", role: "owner" }] };

  test("plugins span both marketplaces; only used ones are declared", () => {
    const m = resolve(def, user, { storeRoot: STORE });
    expect(m.plugins.sort()).toEqual(["plug-a@mkt-1", "plug-b@mkt-2"]);
    expect(m.marketplaces).toEqual({
      "mkt-1": {
        claude: { source: "org/mkt-1", name: "mkt-1" },
        codex: { source: "org/mkt-1", name: "mkt-1" },
      },
      "mkt-2": {
        claude: { source: "org/mkt-2", name: "mkt-2" },
        codex: { source: "org/mkt-2", name: "mkt-2" },
      },
    });
  });
});

// ---- provider guards (stub-specific) ----
describe("provider guards", () => {
  test("unknown namespace throws", () => {
    expect(() => stubProviderFor("nope")).toThrow(/unknown namespace/);
  });
  test("unknown user rejects", () => {
    expect(stubProviderFor("acme").resolveUser("ghost")).rejects.toThrow(/unknown user/);
  });
});
