import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RecordId, type Surreal } from "surrealdb";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyGraph } from "../src/graph/apply.ts";
import { surrealConfig, surrealReachable, connectSurreal, connectAsPassword } from "../src/provider/surreal.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";
import { readConsoleJournals } from "../src/server/console.ts";
import { createJournalServer } from "../src/mcp/journal.ts";
const cfg = surrealConfig("acme_journal_test");
const available = await surrealReachable(cfg);
(available ? describe : describe.skip)("immutable personal journal", () => {
  let root: Surreal, member: Surreal, other: Surreal, admin: Surreal;
  let first: RecordId;
  beforeAll(async () => {
    root = await connectSurreal(cfg);
    const users = structuredClone(exampleUsers); users.ada!.journalAdmin = true;
    await applyGraph(root, { ...structuredClone(exampleDefinition), namespace: cfg.db }, users, { reset: true });
    for (const id of ["ada", "ben", "cleo"]) await root.query("UPSERT type::record('credential', $id) SET pass = crypto::argon2::generate($pass)", { id, pass: "journal-test-password" });
    member = await connectAsPassword(cfg, "cleo", "journal-test-password");
    other = await connectAsPassword(cfg, "ben", "journal-test-password");
    admin = await connectAsPassword(cfg, "ada", "journal-test-password");
  });
  afterAll(async () => { await member.close(); await other.close(); await admin.close(); await root.query("REMOVE DATABASE acme_journal_test"); await root.close(); });
  test("database stamps author, isolates readers, and allows explicit administration", async () => {
    const [created] = await member.query<[{ id: RecordId; author: RecordId }[]]>("CREATE journal SET text = 'First note', author = user:ada");
    first = created[0]!.id;
    expect(String(created[0]!.author)).toBe("user:cleo");
    expect((await other.query<[unknown[]]>("SELECT * FROM journal"))[0]).toHaveLength(0);
    expect((await admin.query<[unknown[]]>("SELECT * FROM journal"))[0]).toHaveLength(1);
    await member.query("UPDATE user:cleo SET journalAdmin = true");
    expect((await member.query<[{ journalAdmin?: boolean }[]]>("SELECT journalAdmin FROM user:cleo"))[0][0]?.journalAdmin).not.toBe(true);
  });
  test("neither author nor administrator can edit or delete; references preserve continuity", async () => {
    for (const db of [member, admin]) {
      await db.query("UPDATE $id SET text = 'changed'", { id: first });
      await db.query("DELETE $id", { id: first });
    }
    expect((await member.query<[{ text: string }[]]>("SELECT * FROM $id", { id: first }))[0][0]!.text).toBe("First note");
    const [continuation] = await member.query<[{ previous: RecordId }[]]>("CREATE journal SET text = 'Continuation', previous = $id", { id: first });
    expect(String(continuation[0]!.previous)).toBe(String(first));
  });
  test("MCP appends and paginates without accepting author overrides", async () => {
    const server = createJournalServer(() => connectAsPassword(cfg, "cleo", "journal-test-password"));
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st);
    const client = new Client({ name: "test", version: "1" }); await client.connect(ct);
    try {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(["append-journal", "list-journals"]);
      expect((await client.callTool({ name: "append-journal", arguments: { text: "MCP note", author: "ada" } })).isError).toBe(true);
      expect((await client.callTool({ name: "append-journal", arguments: { text: "Bad reference", previous: "absent" } })).isError).toBe(true);
      const appended = await client.callTool({ name: "append-journal", arguments: { text: "MCP note" } });
      expect(appended.isError).not.toBe(true);
      const continued = await client.callTool({ name: "append-journal", arguments: { text: "Follow-up", previous: String(first.id) } });
      expect(continued.isError).not.toBe(true);
      expect(JSON.parse((continued.content as { text: string }[])[0]!.text).entry.previous).toBe(String(first.id));
      const listed = await client.callTool({ name: "list-journals", arguments: { limit: 1 } });
      expect(listed.isError).not.toBe(true);
      const body = JSON.parse((listed.content as { text: string }[])[0]!.text);
      expect(body.entries).toHaveLength(1); expect(body.nextOffset).toBe(1);
    } finally { await client.close(); await server.close(); }
  });
  test("console reads journals as the personal identity and respects pagination", async () => {
    const env = (user: string) => ({ SURREAL_URL: cfg.url, SURREAL_NS: cfg.ns,
      MEROVINGIAN_DB: cfg.db, MEROVINGIAN_USER: user, MEROVINGIAN_PASS: "journal-test-password" });
    await expect(readConsoleJournals(cfg.db, 0, 1, { ...env("cleo"), MEROVINGIAN_PASS: "wrong-password" })).rejects.toMatchObject({ code: "invalid_credentials" });
    const personal = await readConsoleJournals(cfg.db, 0, 1, env("cleo"));
    expect(personal.identity).toBe("cleo"); expect(personal.scope).toBe("personal");
    expect(personal.entries).toHaveLength(1); expect(personal.nextOffset).toBe(1);
    expect(personal.entries[0]!.author).toBe("cleo");
    const invisible = await readConsoleJournals(cfg.db, 0, 50, env("ben"));
    expect(invisible.entries).toHaveLength(0);
    const all = await readConsoleJournals(cfg.db, 0, 50, env("ada"));
    expect(all.scope).toBe("tenant"); expect(all.entries.length).toBeGreaterThan(1);
    await expect(readConsoleJournals(cfg.db, 0, 1, { ...env("ada"), MEROVINGIAN_DB: "other_tenant" })).rejects.toThrow("same connection and tenant");
  });
  test("deploy preserves journal entries and revokes administrative reading", async () => {
    const users = structuredClone(exampleUsers);
    await applyGraph(root, { ...structuredClone(exampleDefinition), namespace: cfg.db }, users);
    expect((await admin.query<[unknown[]]>("SELECT * FROM journal"))[0]).toHaveLength(0);
    expect((await member.query<[unknown[]]>("SELECT * FROM journal"))[0].length).toBeGreaterThan(0);
  });

});
