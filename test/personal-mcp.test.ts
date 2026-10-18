import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Surreal } from "surrealdb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { applyGraph } from "../src/graph/apply.ts";
import { surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";

const cfg = surrealConfig("acme_personal_mcp_test");
const available = await surrealReachable(cfg);
const entrypoint = resolve(import.meta.dir, "../bin/merovingian.ts");
const personalEnv = {
  SURREAL_URL: cfg.url, SURREAL_NS: cfg.ns, MEROVINGIAN_DB: cfg.db,
  MEROVINGIAN_USER: "cleo", MEROVINGIAN_PASS: "personal-mcp-test-password",
};
const body = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text);

(available ? describe : describe.skip)("personal MCP processes outside the source workspace", () => {
  let root: Surreal;
  const workspaces: string[] = [];
  beforeAll(async () => {
    root = await connectSurreal(cfg);
    await applyGraph(root, { ...structuredClone(exampleDefinition), namespace: cfg.db }, structuredClone(exampleUsers), { reset: true });
    await root.query("UPSERT credential:cleo SET pass = crypto::argon2::generate($pass)", { pass: personalEnv.MEROVINGIAN_PASS });
    for (let i = 0; i < 2; i++) workspaces.push(await mkdtemp(join(tmpdir(), "mero-personal-mcp-")));
  });
  afterAll(async () => {
    await root.query("REMOVE DATABASE acme_personal_mcp_test"); await root.close();
    for (const directory of workspaces) await rm(directory, { recursive: true, force: true });
  });
  async function use(server: string, cwd: string, work: (client: Client) => Promise<void>, env = personalEnv) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint, "mcp", server], cwd, env, stderr: "pipe" });
    const client = new Client({ name: "personal-connection-test", version: "1" });
    try { await client.connect(transport); await work(client); } finally { await client.close(); }
  }
  test("same private configuration serves two unrelated folders, with no build or root credential", async () => {
    let revision: string | undefined;
    for (const directory of workspaces) {
      await use("catalog", directory, async client => {
        expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(["catalog", "identity"]);
        expect(body(await client.callTool({ name: "identity", arguments: {} })).identity.id).toBe("cleo");
        const catalog = body(await client.callTool({ name: "catalog", arguments: { client: "claude" } }));
        expect(catalog.purposes.map((p: { id: string }) => p.id)).toEqual(["delivery"]);
        if (revision) expect(catalog.revision).toBe(revision);
        revision = catalog.revision;
        expect(JSON.stringify(catalog)).not.toContain(personalEnv.MEROVINGIAN_PASS);
      });
    }
  });
  test("journal written in one folder is readable in the other", async () => {
    let id: string;
    await use("journal", workspaces[0]!, async client => {
      const result = await client.callTool({ name: "append-journal", arguments: { text: "Synthetic process integration test" } });
      expect(result.isError).not.toBe(true); id = body(result).entry.id;
    });
    await use("journal", workspaces[1]!, async client => {
      const result = await client.callTool({ name: "list-journals", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(body(result).entries[0].id).toBe(id!);
      expect(body(result).entries[0].author).toBe("cleo");
    });
  });
  test("bad personal credential gives an error over stdio without leaking the secret", async () => {
    await use("catalog", workspaces[0]!, async client => {
      const result = await client.callTool({ name: "catalog", arguments: {} });
      expect(result.isError).toBe(true);
      expect(body(result).error.code).toBe("invalid_credentials");
      expect(JSON.stringify(result)).not.toContain("wrong-personal-password");
    }, { ...personalEnv, MEROVINGIAN_PASS: "wrong-personal-password" });
  });
});
