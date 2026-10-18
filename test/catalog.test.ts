import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveCatalog, canonical, revisionOf, CatalogError } from "../src/catalog/catalog.ts";
import { catalogConfig } from "../src/catalog/session.ts";
import { createCatalogServer } from "../src/mcp/catalog.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";
import { parseGraph } from "../src/graph/load-graph.ts";
import { desiredState, planGraph } from "../src/graph/plan.ts";
import { structuralRecords } from "../src/graph/records.ts";

const fixture = () => structuredClone(exampleDefinition);
const user = exampleUsers.cleo!;
test("catalog preserves scoped reads/owns without exporting legacy prompts, server paths or tool secrets", () => {
  const d = fixture();
  d.toolCatalog.tracker = { kind: "stdio", command: "/PRIVATE/server", args: ["SECRET-ARG"], env: { TOKEN: "SECRET-VALUE" }, keySource: "company" };
  const c = resolveCatalog(d, user);
  const raw = JSON.stringify(c);
  expect(c.purposes.map(p => p.id)).toEqual(["delivery"]);
  expect(c.purposes[0]!.parent).toBeNull();
  expect(c.repositories.find(r => r.id === "kb-method")!.access).toBe("read");
  expect(c.repositories.find(r => r.id === "kb-projects")!.access).toBe("write");
  for (const secret of ["PRIVATE", "SECRET-ARG", "SECRET-VALUE", "librarySkills", "toolEnv", "additionalDirectories"]) expect(raw).not.toContain(secret);
  expect(c.tools).toEqual([{ id: "tracker", kind: "stdio", status: "declared", configuration: "out_of_band", requiredEnvironment: ["TOKEN"], credentialSource: "company" }]);
});

test("revision is stable across insertion order and changes outside the user's slice", () => {
  const a = fixture(); const b = fixture();
  b.purposes.reverse(); b.buckets.reverse();
  b.purposes.find(p => p.id === "content")!.reason = "PRIVATE CHANGE";
  expect(resolveCatalog(a, user).revision).toBe(resolveCatalog(b, user).revision);
  b.ambient.instructions = "Updated tenant instructions";
  expect(resolveCatalog(a, user).revision).not.toBe(resolveCatalog(b, user).revision);
  expect(revisionOf({ b: 1, a: 2 })).toBe(revisionOf({ a: 2, b: 1 }));
  expect(canonical({ omitted: undefined, a: [] })).toBe('{"a":[]}');
});

test("plugins are explicit; missing client bindings and legacy skills are not fabricated", () => {
  const d = fixture();
  d.skillCatalog.old = {source: "library", files: {"SKILL.md": "Historical only"}};
  d.ambient.skills.push("old");
  d.skillCatalog.sample = { source: "plugin", plugin: "sample", marketplace: "samples" };
  d.marketplaces.samples = { claude: { source: "acme-labs/samples", name: "samples" } };
  d.purposes.find(p => p.id === "delivery")!.skills.push("sample");
  const c = resolveCatalog(d, user, "codex");
  expect(c.plugins).toContainEqual({ id: "sample@samples", versionStatus: "not_verified" });
  expect(c.marketplaces).toContainEqual({ id: "samples", bindings: [{ client: "codex", status: "unsupported" }] });
  expect(c.diagnostics[0]!.code).toBe("undistributed_skills");
  expect(() => resolveCatalog(d, { ...user, assignments: [] })).toThrow(CatalogError);
});

test("password configuration has no administrator, service or dev-mint fallback", () => {
  expect(() => catalogConfig({})).toThrow("SURREAL_URL");
  const env = { SURREAL_URL: "ws://localhost:8020/rpc", SURREAL_NS: "merovingian", MEROVINGIAN_DB: "acme", MEROVINGIAN_USER: "cleo", MEROVINGIAN_PASS: "personal-pass", SURREAL_USER: "root", SURREAL_PASS: "root", MEROVINGIAN_SERVICE_URL: "https://unrelated.example" };
  const config = catalogConfig(env);
  expect(config.cfg.username).toBe(""); expect(config.cfg.password).toBe("");
  expect(config.password).toBe("personal-pass");
  expect(() => catalogConfig({ ...env, MEROVINGIAN_PASS: "" })).toThrow("MEROVINGIAN_PASS");
  expect(() => catalogConfig({ ...env, SURREAL_URL: "https://user:secret@example.com" })).toThrow("without embedded credentials");
});

test("administrative profile fields survive parsing, desired state and record serialization", () => {
  const parsed = parseGraph(`namespace: acme\npurposes:\n  - id: core\n    reason: Work\nusers:\n  - id: cleo\n    name: Cleo\n    github: cleo-example\n    email: cleo@example.com\n    slackId: UEXAMPLE\n    assignments: [{purpose: core}]\n`);
  expect(parsed.users.cleo!.email).toBe("cleo@example.com");
  const state = desiredState(parsed.definition, parsed.users);
  const previous = structuredClone(state); delete previous.users.cleo!.email;
  expect(planGraph(state, previous).update.find(r => r.kind === "user")!.changes.some(c => c.field === "email")).toBe(true);
  const records = structuralRecords(parsed.definition, parsed.users);
  expect(records.find(r => String(r.recordId) === "user:cleo")!.content.slackId).toBe("UEXAMPLE");
});

test("MCP returns structured catalog, rejects identity override, and sanitizes unexpected failures", async () => {
  let fail = false;
  const server = createCatalogServer(async c => { if (fail) throw new Error("SECRET FROM DRIVER"); return resolveCatalog(fixture(), user, c); });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "catalog-test", version: "1" }); await client.connect(ct);
  try {
    expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(["catalog", "identity"]);
    const own = await client.callTool({ name: "identity", arguments: {} });
    expect(JSON.stringify(own)).toContain('cleo');
    const override = await client.callTool({ name: "catalog", arguments: { user: "ada" } });
    expect(override.isError).toBe(true);
    fail = true;
    const err = await client.callTool({ name: "catalog", arguments: {} });
    expect(err.isError).toBe(true); expect(JSON.stringify(err)).not.toContain("SECRET FROM DRIVER");
    expect(JSON.stringify(err)).toContain("unavailable");
  } finally { await client.close(); await server.close(); }
});
