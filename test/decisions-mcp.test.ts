// The decisions MCP (ADR 0013), driven through a real MCP client. Proves:
// register-decision appends to decision_log AS the identity (and reports the
// silent-no-op block as a readable error — the domain-list env is affordance,
// never authority); search/get serve the ratified records tenant-wide.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDecisionsServer, domainsFromEnv } from "../src/mcp/decisions.ts";
import { surrealConfig, surrealReachable, connectSurreal, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";

const TEST_DB = "acme_decisions_mcp";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  const db = await connectSurreal(cfg);
  await db.query("DELETE decision_log");
  await db.close();
}

async function call(userId: string, domains: string[], tool: string, args: Record<string, unknown>): Promise<string> {
  const server = createDecisionsServer({ cfg, getToken: async () => mintIdentityJwt(cfg, userId), domains });
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

(dbUp ? describe : describe.skip)("decisions MCP (register + consult, mount ≠ authority)", () => {
  test("ben registers an editorial decision, grounded in a record", async () => {
    const out = await call("ben", ["editorial"], "register-decision", {
      decisionType: "editorial",
      text: "kept the informal voice for the dev-tools post — the record's 'direct' reads informal in PT",
      records: ["editorial/0001-voice"],
    });
    expect(out).toContain("decision recorded (editorial)");
    expect(out).toContain("editorial/0001-voice");

    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[{ user: string; records: unknown[] }[]]>(
        "SELECT record::id(user) AS user, records FROM decision_log",
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.user).toBe("ben");
      expect(rows[0]!.records?.length).toBe(1);
    } finally {
      await db.close();
    }
  });

  test("edge validation: a domain outside the env list is refused with a hint", async () => {
    const out = await call("ben", ["editorial"], "register-decision", { decisionType: "pricing", text: "x" });
    expect(out).toContain(`"pricing" is not one of your decision domains`);
  });

  test("mount ≠ authority: env handed 'pricing' anyway — the db blocks ben, readably", async () => {
    // ben (content) is outside sales' lineage: the CREATE is a silent no-op ([]),
    // and the tool reports it instead of lying "recorded".
    const out = await call("ben", ["pricing"], "register-decision", { decisionType: "pricing", text: "forged" });
    expect(out).toContain("decision NOT recorded");

    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[unknown[]]>(`SELECT * FROM decision_log WHERE domain = "pricing"`);
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("search-decisions: records are tenant-wide — ben searches pricing jurisprudence", async () => {
    const out = await call("ben", ["editorial"], "search-decisions", { decisionType: "pricing", query: "floor" });
    expect(out).toContain("pricing/0001-enterprise-floor");
    expect(out).toContain("accepted");
  });

  test("get-decision returns the full record; a bogus id reads as absent", async () => {
    const out = await call("cleo", [], "get-decision", { id: "pricing/0001-enterprise-floor" });
    expect(out).toContain("# Enterprise tier price floor");
    expect(out).toContain("never quoted below 20k");
    expect(await call("cleo", [], "get-decision", { id: "pricing/9999-ghost" })).toContain("no record");
  });

  test("domainsFromEnv parses the emit-stamped env", () => {
    expect(domainsFromEnv({ MEROVINGIAN_DECISION_DOMAINS: '["pricing","scope"]' } as NodeJS.ProcessEnv)).toEqual(["pricing", "scope"]);
    expect(domainsFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(domainsFromEnv({ MEROVINGIAN_DECISION_DOMAINS: "broken{" } as NodeJS.ProcessEnv)).toEqual([]);
  });
});
