// Tests for `login` backend selection (local path). The gap this covers: a REAL
// local tenant (live surreal db, no remote service) is not in the stub fixture,
// so `login <ns> <user> --backend surreal` must resolve the user against the
// migrated db — the stub-only path failed with `unknown namespace`.
// Surreal-only (own db, skip if down). Runs against the generic `acme` example.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Surreal } from "surrealdb";
import { applyGraph } from "../src/graph/apply.ts";
import { passwd } from "../src/commands/passwd.ts";
import { login } from "../src/commands/login.ts";
import { sessionFile } from "../src/paths.ts";
import { surrealConfig, surrealReachable, connectSurreal } from "../src/provider/surreal.ts";
import { writeNamespace } from "../src/transport.ts";
import { exampleDefinition, exampleUsers } from "../fixtures/example/graph.ts";

// login() derives its connection from surrealConfig(namespace) — db = namespace —
// so the test namespace IS the throwaway test db. Config is resolved at CALL time
// (like login itself), never at module load: load-time env may be polluted by
// sibling test files.
const TEST_NS = "acme_login_test";
const dbUp = await surrealReachable(surrealConfig(TEST_NS));

(dbUp ? describe : describe.skip)("login (surreal backend)", () => {
  let db: Surreal;

  beforeAll(async () => {
    db = await connectSurreal(surrealConfig(TEST_NS));
    await applyGraph(db, { ...structuredClone(exampleDefinition), namespace: TEST_NS }, structuredClone(exampleUsers), { reset: true });
    await passwd(TEST_NS, "ada", {password: "synthetic-password"});
  });

  afterAll(async () => {
    await db.query(`REMOVE DATABASE \`${TEST_NS}\``);
    await db.close();
    // the session dir this test creates under ~/.merovingian
    await rm(dirname(sessionFile(TEST_NS)), { recursive: true, force: true });
  });

  test("resolves a real user against the live db and writes the session", async () => {
    await login(TEST_NS, "ada", { backend: "surreal", password: "synthetic-password" });
    const path = sessionFile(TEST_NS);
    expect(existsSync(path)).toBe(true);
    const session = JSON.parse(await readFile(path, "utf8"));
    expect(session.namespace).toBe(TEST_NS);
    expect(session.user).toBe("ada");
  });

  test("does not turn administrator credentials into a personal login", async () => {
    await expect(login(TEST_NS, "ada", { backend: "surreal", password: "" })).rejects.toThrow("MEROVINGIAN_PASS");
  });

  test("rejects a user that is not in the graph", async () => {
    await expect(login(TEST_NS, "nobody", { backend: "surreal", password: "synthetic-password" })).rejects.toThrow(/Personal identity SIGNIN/);
  });

  test("passwd reports operator credential source and target without leaking the password", async () => {
    const previous = process.env.SURREAL_PASS;
    process.env.SURREAL_PASS = "wrong-synthetic-operator-password";
    try {
      let failure: Error | undefined;
      try { await passwd(TEST_NS, "ada", { password: "synthetic-new-password" }); }
      catch (error) { failure = error as Error; }
      expect(failure).toBeDefined();
      expect(failure!.message).toContain("root → namespace → database");
      expect(failure!.message).toContain("SURREAL_PASS (environment)");
      expect(failure!.message).toContain(surrealConfig(TEST_NS).db);
      expect(failure!.message).not.toContain("wrong-synthetic-operator-password");
      expect(failure!.message).not.toContain("synthetic-new-password");
    } finally {
      if (previous === undefined) delete process.env.SURREAL_PASS;
      else process.env.SURREAL_PASS = previous;
    }
  });

  test("stub backend still rejects a namespace that is not a fixture", async () => {
    await expect(login(TEST_NS, "ada", { backend: "stub" })).rejects.toThrow(/unknown namespace/);
  });

  // regression: a per-tenant SURREAL registration (merovingian.toml → namespace.json)
  // must NOT flip login onto the remote-HTTP path (it fetch()ed the ws:// url).
  test("a surreal-transport registry entry keeps login on the local path", async () => {
    await writeNamespace(TEST_NS, { transport: "surreal", url: surrealConfig(TEST_NS).url });
    await login(TEST_NS, "ada", { backend: "surreal", password: "synthetic-password" });
    const session = JSON.parse(await readFile(sessionFile(TEST_NS), "utf8"));
    expect(session.user).toBe("ada");
  });
});
