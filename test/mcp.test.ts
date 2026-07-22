// The surreal-data MCP (manifest-driven, ADR 0011), driven through a real MCP client
// over an in-memory transport. Proves enforcement reaches the TOOL layer — and that
// the mount list is affordance, never authority: ben handed the mounts still gets zero.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSurrealDataServer, mountsFromEnv, type BucketMount } from "../src/mcp/surreal-data.ts";
import { surrealConfig, surrealReachable, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { seedAcme } from "../fixtures/example/seed.ts";

const TEST_DB = "acme_mcp";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

// cleo's real mounts, as emit would stamp them
const MOUNTS: BucketMount[] = [{ bucket: "clients", tables: ["client", "contact"], scope: "account:north" }];

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  await seedAcme(TEST_DB);
} else {
  console.log(`[mcp] SurrealDB unavailable at ${cfg.url} — skipping. (bun run db:up)`);
}

/** Spin the server for a user, connect a client over in-memory transport, call a tool. */
async function callTool(userId: string, name: string, args: Record<string, unknown> = {}, mounts = MOUNTS): Promise<string> {
  const server = createSurrealDataServer({ cfg, getToken: async () => mintIdentityJwt(cfg, userId), mounts });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  try {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[] };
    return res.content.map((c) => c.text).join("\n");
  } finally {
    await client.close();
    await server.close();
  }
}

(dbUp ? describe : describe.skip)("surreal-data MCP (manifest-driven; enforcement reaches the tool)", () => {
  test("tools/list exposes the two generic tools; select's description names the tables", async () => {
    const server = createSurrealDataServer({ cfg, getToken: async () => mintIdentityJwt(cfg, "cleo"), mounts: MOUNTS });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientT);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["select", "tables"]);
      expect(tools.find((t) => t.name === "select")!.description).toContain("client, contact");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("tables renders the mounts (no DB touch)", async () => {
    const out = await callTool("cleo", "tables");
    expect(out).toContain("clients — tables: client, contact — scope: account:north");
  });

  test("cleo → select client shows only north", async () => {
    const out = await callTool("cleo", "select", { table: "client" });
    expect(out).toContain("north");
    expect(out).not.toContain("west");
    expect(out).not.toContain("east");
  });

  test("cleo → select client filter west is blocked by the backend", async () => {
    expect(await callTool("cleo", "select", { table: "client", filter: { account: "west" } })).toContain("no rows");
  });

  test("cleo → select client filter north returns the row", async () => {
    expect(await callTool("cleo", "select", { table: "client", filter: { account: "north" } })).toContain("North Co");
  });

  test("ben HANDED the mounts still gets zero — mount is affordance, never authority", async () => {
    expect(await callTool("ben", "select", { table: "client" })).toContain("no rows");
  });

  test("a table outside the mounts is rejected before any query", async () => {
    expect(await callTool("cleo", "select", { table: "proposal" })).toContain("not in your workspace");
  });

  test("invalid filter fields are rejected", async () => {
    expect(await callTool("cleo", "select", { table: "client", filter: { "a; REMOVE TABLE user": "x" } })).toContain("invalid filter field");
  });

  test("mountsFromEnv parses the emit-stamped JSON; garbage = no mounts", () => {
    expect(mountsFromEnv({ MEROVINGIAN_BUCKETS: JSON.stringify(MOUNTS) })).toEqual(MOUNTS);
    expect(mountsFromEnv({ MEROVINGIAN_BUCKETS: "not json" })).toEqual([]);
    expect(mountsFromEnv({})).toEqual([]);
  });
});
