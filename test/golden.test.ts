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

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Narrow an .mcp.json entry to the stdio shape (command/args/env). */
function stdio(e: unknown): { command: string; args: string[]; env: Record<string, string> } {
  return e as { command: string; args: string[]; env: Record<string, string> };
}

import { buildServiceFor } from "../src/service/build-service.ts";
import { reset } from "../src/commands/reset.ts";
import { surrealConfig, surrealReachable } from "../src/provider/surreal.ts";
import { stubProviderFor } from "../src/provider/stub.ts";
import { buildSettings, buildMcp, emit } from "../src/projection/emit.ts";
import { resolveToolEnv, resolve } from "../src/projection/resolve.ts";
import type { Definition, User } from "../src/provider/types.ts";
import { renderGraph } from "../src/commands/graph.ts";
import type { Manifest } from "../src/projection/resolve.ts";

const STORE = "/STORE";
const TEST_DB = "acme_test";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");

type GetManifest = (userId: string, purposes?: string[]) => Promise<Manifest>;

function getterFor(backend: "stub" | "surreal"): GetManifest {
  return async (userId, purposes) => {
    const { service, close } = await buildServiceFor("acme", {
      backend,
      storeRoot: STORE,
      ...(backend === "surreal" ? { surrealDb: TEST_DB } : {}),
    });
    try {
      return await service.getManifest(userId, { purposes });
    } finally {
      await close();
    }
  };
}

// ---- the shared assertions, parameterized over the backend's manifest getter ----
function runGolden(get: GetManifest) {
  describe("ada (owner @ root)", () => {
    test("sees the whole tree", async () => {
      const m = await get("ada");
      expect(m.visiblePurposes).toContain("acme");
      expect(m.visiblePurposes).toContain("content");
      expect(m.visiblePurposes).toContain("method");
      expect(m.visiblePurposes.length).toBe(9);
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
    test("root sees the shell agent (library) AND the ambient skills; externals span guild", async () => {
      const m = await get("ada");
      expect(m.libraryAgents.map((a) => a.name)).toContain("core"); // shell: root purpose visible
      expect(m.librarySkills.map((s) => s.name)).toEqual(expect.arrayContaining(["journal", "friction"])); // always on
      // the only EXTERNAL content in the tree: the audit skill + the sales agent
      expect(m.plugins.sort()).toEqual(["compliance@guild", "sales-advisor@guild"].sort());
      expect(m.marketplaces).toEqual({ guild: "acme-labs/guild" });
    });
  });

  describe("ben (content)", () => {
    test("sees only content + what content reads", async () => {
      const m = await get("ben");
      expect(m.visiblePurposes).toEqual(["content"]);
      expect(m.okf.map((o) => o.repo).sort()).toEqual(
        ["acme-labs/kb-company", "acme-labs/kb-content", "acme-labs/kb-method"].sort(),
      );
    });
    test("sees NO sensitive surreal data", async () => {
      expect((await get("ben")).surreal).toEqual([]);
    });
    test("gets content library skills + agent (NOT the root shell), zero externals", async () => {
      const m = await get("ben");
      expect(m.librarySkills.map((s) => s.name)).toEqual(["edit", "friction", "journal", "pending", "write"]);
      expect(m.libraryAgents.map((a) => a.name)).toEqual(["content"]);
      // scoped workspace never gets the root shell persona
      expect(m.libraryAgents.map((a) => a.name)).not.toContain("core");
      // a pure-library slice: no external plugins, no marketplaces
      expect(m.plugins).toEqual([]);
      expect(m.marketplaces).toEqual({});
    });
    test("library content round-trips byte-exact (multi-file skill + agent)", async () => {
      const m = await get("ben");
      const journal = m.librarySkills.find((s) => s.name === "journal")!;
      expect(Object.keys(journal.files).sort()).toEqual(["SKILL.md", "format.md"].sort());
      expect(journal.files["format.md"]).toContain("Context gaps");
      expect(m.libraryAgents.find((a) => a.name === "content")!.content).toContain("public content");
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
    test("gets the delivery agent (agent-only purpose) + ambient skills, zero externals", async () => {
      const m = await get("cleo");
      // delivery has no skills — the persona still loads via its agent (agentByPurpose)
      expect(m.libraryAgents.map((a) => a.name)).toEqual(["delivery"]);
      expect(m.librarySkills.map((s) => s.name)).toEqual(["friction", "journal", "pending"]);
      expect(m.plugins).toEqual([]);
      expect(m.marketplaces).toEqual({});
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

  describe("scope is generated, not enforced", () => {
    test("cleo env carries a fake token, never ANTHROPIC_API_KEY", async () => {
      const s = buildSettings(await get("cleo"));
      expect(s.env.MEROVINGIAN_TOKEN).toBe("fake-cleo-token");
      expect(s.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    });
    test("cleo .mcp.json stamps SCOPE on the clients server", async () => {
      const mcp = buildMcp(await get("cleo"));
      expect(stdio(mcp.mcpServers["surreal-clients"]).env.SCOPE).toBe("account:north");
    });
    test("ada clients server has no client scope (unscoped owner)", async () => {
      const mcp = buildMcp(await get("ada"));
      expect(stdio(mcp.mcpServers["surreal-clients"]).env).not.toHaveProperty("SCOPE");
    });
    test("system MCPs are invoked via the CLI's mcp subcommand — never a module path that dies with a cache", async () => {
      // dev/checkout form: bun run <abs bin/merovingian.ts> mcp <name>. Installed
      // from npm it becomes bunx --bun @supernova-labs/merovingian mcp <name> —
      // the .mcp.json outlives this process, so no path into src/ may leak into it.
      const mcp = buildMcp(await get("ada"), { url: "ws://x/rpc", ns: "merovingian", db: "acme", user: "ada" });
      for (const name of ["inbox", "decisions", "surreal-data"] as const) {
        const def = stdio(mcp.mcpServers[name]);
        expect(def.args.slice(-2)).toEqual(["mcp", name]);
        expect(def.args.join(" ")).not.toContain("src/mcp");
      }
    });
    test("settings shapes match the real installed schema (externals only)", async () => {
      // ada spans the externals (audit skill + sales agent, both @guild)
      const s = buildSettings(await get("ada"));
      expect(s.enableAllProjectMcpServers).toBe(true);
      expect(s.extraKnownMarketplaces["guild"]).toEqual({
        source: { source: "github", repo: "acme-labs/guild" },
        autoUpdate: true,
      });
      // registered-but-unused marketplaces are never declared
      expect(s.extraKnownMarketplaces["partner-plugins"]).toBeUndefined();
      expect(s.enabledPlugins).toEqual({
        "compliance@guild": true,
        "sales-advisor@guild": true,
      });
      // a pure-library slice declares nothing external at all
      const ben = buildSettings(await get("ben"));
      expect(ben.extraKnownMarketplaces).toEqual({});
      expect(ben.enabledPlugins).toEqual({});
    });
  });

  describe("--purposes narrows, can only subtract", () => {
    test("ada narrows to just the content subgraph", async () => {
      const m = await get("ada", ["content"]);
      expect(m.visiblePurposes).toEqual(["content"]);
      expect(m.surreal).toEqual([]);
      expect(m.libraryAgents.map((a) => a.name)).toEqual(["content"]);
      expect(m.plugins).toEqual([]); // the externals live outside this slice
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
      expect(out).toContain("--purposes");
    });
  });

  describe("tool registry (pipes via catalog) + secret in the right drawer", () => {
    test("ben: search (company) and docs (none) resolved from the catalog", async () => {
      const m = await get("ben");
      expect(m.toolMounts.find((t) => t.name === "search")?.command).toBe("uvx");
      expect(m.toolMounts.find((t) => t.name === "search")?.keySource).toBe("company");
      expect(m.toolMounts.find((t) => t.name === "docs")?.keySource).toBe("none");
    });

    test("company key goes to the settings env, NOT to .mcp.json", async () => {
      const m = await get("ben");
      m.toolEnv = resolveToolEnv(m.toolMounts, { SEARCH_API_KEY: "sk-test" });
      expect(stdio(buildMcp(m).mcpServers["search"]).env).toEqual({}); // no secret in the mcp (committable)
      expect(buildSettings(m).env.SEARCH_API_KEY).toBe("sk-test"); // secret in settings.local (gitignored)
    });

    test("a remote (sse) tool emits {type, url} — no command, no env, no secret", async () => {
      const m = await get("cleo"); // delivery carries the remote `tracker`
      expect(m.toolMounts.find((t) => t.name === "tracker")).toEqual({
        name: "tracker", kind: "sse", args: [], env: {}, keySource: "none", url: "https://mcp.example.dev/sse",
      });
      expect(buildMcp(m).mcpServers["tracker"]).toEqual({ type: "sse", url: "https://mcp.example.dev/sse" });
    });

    test("surreal-data: token SOURCE in env, no embedded JWT", async () => {
      const m = await get("cleo");
      const dev = buildMcp(m, { url: "u", ns: "merovingian", db: "acme", user: "cleo" }).mcpServers["surreal-data"];
      expect(stdio(dev).command).toBe("bun");
      expect(stdio(dev).env.MEROVINGIAN_USER).toBe("cleo");
      expect(stdio(dev).env).not.toHaveProperty("MEROVINGIAN_JWT");
      const remote = buildMcp(m, { url: "u", ns: "merovingian", db: "acme", service: "http://localhost:8787", namespace: "acme" }).mcpServers["surreal-data"];
      expect(stdio(remote).env.MEROVINGIAN_SERVICE_URL).toBe("http://localhost:8787");
      expect(stdio(remote).env).not.toHaveProperty("MEROVINGIAN_JWT");
    });

    test("surreal-data: MEROVINGIAN_BUCKETS carries the identity's mounts (ADR 0011)", async () => {
      const m = await get("cleo");
      const dev = buildMcp(m, { url: "u", ns: "merovingian", db: "acme", user: "cleo" }).mcpServers["surreal-data"];
      const mounts = JSON.parse(stdio(dev).env.MEROVINGIAN_BUCKETS!) as { bucket: string; tables: string[]; scope?: string }[];
      expect(mounts).toEqual([{ bucket: "clients", tables: ["client", "contact"], scope: "account:north" }]);
    });
  });

  describe("emit materializes the workspace", () => {
    const dirs: string[] = [];
    function tmp(): string {
      const d = mkdtempSync(join(tmpdir(), "merovingian-golden-"));
      dirs.push(d);
      return d;
    }
    afterEach(() => {
      while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    });

    test("writes the projected workspace, library content materialized", async () => {
      const m = await get("cleo");
      const target = tmp();
      const { files } = await emit(m, target);
      // 4 core files + journal (SKILL.md, format.md) + friction + pending + the delivery agent
      expect(files.length).toBe(9);
      for (const f of [
        "CLAUDE.md", ".mcp.json", ".claude/settings.local.json", ".merovingian/build.json",
        ".claude/skills/journal/SKILL.md", ".claude/skills/journal/format.md",
        ".claude/skills/friction/SKILL.md", ".claude/skills/pending/SKILL.md", ".claude/agents/delivery.md",
      ]) {
        expect(existsSync(join(target, f))).toBe(true);
      }
      expect(readFileSync(join(target, ".claude/agents/delivery.md"), "utf8")).toContain("delivery persona");
      const settings = JSON.parse(readFileSync(join(target, ".claude", "settings.local.json"), "utf8"));
      expect([...settings.permissions.additionalDirectories].sort()).toEqual(
        [join(STORE, "kb-method"), join(STORE, "kb-projects")].sort(),
      );
      const stamp = JSON.parse(readFileSync(join(target, ".merovingian", "build.json"), "utf8"));
      expect(stamp).toEqual({
        namespace: "acme",
        user: "cleo",
        assignments: [{ purpose: "delivery", scope: "north", role: "member" }],
      });
    });

    test("re-emit removes library content the manifest no longer carries (no stale)", async () => {
      const target = tmp();
      await emit(await get("cleo"), target); // has the delivery agent
      expect(existsSync(join(target, ".claude/agents/delivery.md"))).toBe(true);
      await emit(await get("ben"), target); // content slice — no delivery agent
      expect(existsSync(join(target, ".claude/agents/delivery.md"))).toBe(false);
      expect(existsSync(join(target, ".claude/agents/content.md"))).toBe(true);
      expect(existsSync(join(target, ".claude/skills/write/SKILL.md"))).toBe(true);
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
    marketplaces: { "mkt-1": "org/mkt-1", "mkt-2": "org/mkt-2", "mkt-unused": "org/unused" },
  };
  const user: User = { id: "u", name: "U", assignments: [{ purpose: "p", role: "owner" }] };

  test("plugins span both marketplaces; only used ones are declared", () => {
    const m = resolve(def, user, { storeRoot: STORE });
    expect(m.plugins.sort()).toEqual(["plug-a@mkt-1", "plug-b@mkt-2"]);
    expect(m.marketplaces).toEqual({ "mkt-1": "org/mkt-1", "mkt-2": "org/mkt-2" });
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
