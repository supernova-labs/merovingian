// The inbox MCP, driven through a real MCP client. Proves: journal/friction append
// to Surreal; the `user` is stamped server-side (can't be forged); and record users
// can't read the inbox (FOR select NONE) — only governance/root drains it, via the
// root-only `merovingian inbox` surface (listInbox/drainInbox).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createInboxServer } from "../src/mcp/inbox.ts";
import { surrealConfig, surrealReachable, connectSurreal, connectWithToken, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { listInbox, drainInbox } from "../src/commands/inbox.ts";

const TEST_DB = "acme_inbox";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  // reset wipes STRUCTURE only — inbox rows survive and would skew drain counts.
  const db = await connectSurreal(cfg);
  await db.query("DELETE inbox");
  await db.close();
}

async function call(userId: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const server = createInboxServer({ cfg, getToken: async () => mintIdentityJwt(cfg, userId), purposes: ["content"] });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  try {
    const res = (await client.callTool({ name: tool, arguments: args })) as { content: { text: string }[] };
    return res.content.map((c) => c.text).join("\n");
  } finally {
    await client.close();
    await server.close();
  }
}

async function append(userId: string, tool: "journal" | "friction", text: string, origin?: string): Promise<string> {
  return call(userId, tool, origin ? { text, origin } : { text });
}

(dbUp ? describe : describe.skip)("inbox MCP (append + stamp + governance-only drain)", () => {
  test("cleo appends journal and friction", async () => {
    expect(await append("cleo", "journal", "learned X")).toContain("journal recorded");
    expect(await append("cleo", "friction", "got stuck on Y")).toContain("friction recorded");
  });

  test("root (governance) drains: sees the entries, with stamped user = cleo", async () => {
    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[{ kind: string; text: string; user: unknown }[]]>("SELECT kind, text, record::id(user) AS user FROM inbox");
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.user === "cleo")).toBe(true);
      expect(rows.map((r) => r.kind)).toContain("friction");
    } finally {
      await db.close();
    }
  });

  test("record user can NOT read the inbox (FOR select NONE) — not even their own", async () => {
    const db = await connectWithToken(cfg, mintIdentityJwt(cfg, "cleo"));
    try {
      const [rows] = await db.query<[unknown[]]>("SELECT * FROM inbox");
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("listInbox: undrained entries, full text, oldest first", async () => {
    const entries = await listInbox("acme", { surrealDb: TEST_DB });
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.kind)).toEqual(["journal", "friction"]); // at ASC
    expect(entries.every((e) => e.user === "cleo" && e.drained === null)).toBe(true);
    expect(entries[0]!.text).toBe("learned X");
    expect(entries[1]!.text).toBe("got stuck on Y");
  });

  test("drain by id stamps only that entry; --all shows the stamp", async () => {
    const [first] = await listInbox("acme", { surrealDb: TEST_DB });
    const stamped = await drainInbox("acme", { ids: [first!.id], surrealDb: TEST_DB });
    expect(stamped).toEqual([first!.id]);

    const undrained = await listInbox("acme", { surrealDb: TEST_DB });
    expect(undrained.length).toBe(1);
    expect(undrained[0]!.id).not.toBe(first!.id);

    const all = await listInbox("acme", { all: true, surrealDb: TEST_DB });
    expect(all.length).toBe(2);
    expect(all.find((e) => e.id === first!.id)!.drained).toBeInstanceOf(Date);
  });

  test("drain stamps the rest; list empties; re-drain is a no-op", async () => {
    const stamped = await drainInbox("acme", { surrealDb: TEST_DB });
    expect(stamped.length).toBe(1);
    expect(await listInbox("acme", { surrealDb: TEST_DB })).toEqual([]);
    expect(await drainInbox("acme", { surrealDb: TEST_DB })).toEqual([]);
  });

  test("record user stays blind after the drained field lands", async () => {
    const db = await connectWithToken(cfg, mintIdentityJwt(cfg, "cleo"));
    try {
      const [rows] = await db.query<[unknown[]]>("SELECT * FROM inbox");
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("origin round-trips (self-reported writer context); absent stays null", async () => {
    await append("cleo", "friction", "the tracker broke mid-dispatch", "delivery");
    await append("cleo", "journal", "no origin on this one");
    const entries = await listInbox("acme", { surrealDb: TEST_DB });
    expect(entries.find((e) => e.kind === "friction")).toMatchObject({ origin: "delivery", user: "cleo" });
    expect(entries.find((e) => e.kind === "journal")!.origin).toBeNull();
  });
});

// ─── ADR 0014: the local governance surface (pending / resolve / rescope) ────

(dbUp ? describe : describe.skip)("inbox MCP — scoped frictions (ADR 0014)", () => {
  test("a scoped friction lands in the writer's reach; pending lists it there and ONLY there", async () => {
    const reply = await call("ben", "friction", { text: "kb is stale", origin: "content", scope: "content" });
    expect(reply).toContain("scope purpose:content");

    expect(await call("ben", "pending", {})).toContain("kb is stale");
    expect(await call("cleo", "pending", {})).toContain("no pending frictions"); // content is not in her lineage
  });

  test("scoping outside the projection warns (escalation is fine; typos go to nobody)", async () => {
    const reply = await call("ben", "friction", { text: "needs the parent's reach", scope: "growth" });
    expect(reply).toContain("outside your projection");
  });

  test("resolve stamps drained + the trace; out-of-reach resolve says so", async () => {
    const pending = await call("ben", "pending", {});
    const id = pending.match(/inbox:(\w+)/)![1]!;

    expect(await call("cleo", "resolve", { id, resolvedThrough: "not mine" })).toContain("not in your reach");
    expect(await call("ben", "resolve", { id, resolvedThrough: "PR #7 no kb-content" })).toContain(`resolved inbox:${id}`);

    const all = await listInbox("acme", { all: true, surrealDb: TEST_DB });
    expect(all.find((e) => e.id === id)).toMatchObject({ resolvedThrough: "PR #7 no kb-content", scope: "content" });
    expect(all.find((e) => e.id === id)!.drained).toBeInstanceOf(Date);
    // resolving again: already drained → no-op with a readable answer
    expect(await call("ben", "resolve", { id, resolvedThrough: "x" })).toContain("already drained");
  });

  test("rescope beyond reach is refused with the escalation guidance", async () => {
    await call("ben", "friction", { text: "handoff attempt", scope: "content" });
    const id = (await call("ben", "pending", {})).match(/inbox:(\w+)/)![1]!;
    expect(await call("ben", "rescope", { id, scope: "growth" })).toContain("escalate at creation");
    expect(await call("ben", "pending", {})).toContain("handoff attempt"); // unchanged
  });
});
