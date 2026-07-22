// The build/auth service over real HTTP (Bun.serve), with an injected gh resolver
// so we don't hit GitHub. Proves: gh login → user → scoped manifest + a token that
// actually works against Surreal under enforcement. The client holds no secret.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { startService } from "../src/server/service.ts";
import { surrealConfig, surrealReachable, connectWithToken } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { seedAcme } from "../fixtures/example/seed.ts";

const TEST_DB = "acme_service";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });
const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  await seedAcme(TEST_DB);
}

// fake gh tokens → logins (stands in for the GitHub API)
const GH: Record<string, string> = { "tok-ada": "ada-gh", "tok-cleo": "cleo-gh", "tok-ghost": "nobody" };

// route the service at the test db — and RESTORE it: test files share one
// process, so a leaked SURREAL_DB rewires every later env-derived connection.
const prevSurrealDb = process.env.SURREAL_DB;
process.env.SURREAL_DB = TEST_DB;

let svc: { port: number; stop: () => void };
beforeAll(() => {
  if (!dbUp) return;
  svc = startService({ port: 0, deps: { resolveGithubLogin: async (t) => GH[t] ?? Promise.reject(new Error("bad")) } });
});
afterAll(() => {
  svc?.stop();
  if (prevSurrealDb === undefined) delete process.env.SURREAL_DB;
  else process.env.SURREAL_DB = prevSurrealDb;
});

async function get(path: string, token?: string) {
  const res = await fetch(`http://localhost:${svc.port}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  return { status: res.status, body: await res.json() as any };
}

(dbUp ? describe : describe.skip)("build/auth service (HTTP + gh-auth)", () => {
  test("/whoami resolves the gh login → merovingian user", async () => {
    const { status, body } = await get("/whoami?namespace=acme", "tok-ada");
    expect(status).toBe(200);
    expect(body.user).toBe("ada");
    expect(body.login).toBe("ada-gh");
  });

  test("/manifest returns a scoped manifest + token", async () => {
    const { status, body } = await get("/manifest?namespace=acme", "tok-cleo");
    expect(status).toBe(200);
    expect(body.manifest.assignments).toEqual([{ purpose: "delivery", scope: "north", role: "member" }]);
    expect(typeof body.token).toBe("string");
  });

  test("the returned token WORKS against Surreal under enforcement (cleo → only north)", async () => {
    const { body } = await get("/manifest?namespace=acme", "tok-cleo");
    const db = await connectWithToken(cfg, body.token);
    try {
      const [rows] = await db.query<[{ account: string }[]]>("SELECT account FROM client");
      expect(rows.map((r) => r.account).sort()).toEqual(["north"]);
    } finally {
      await db.close();
    }
  });

  test("no gh token → 401", async () => {
    expect((await get("/manifest?namespace=acme")).status).toBe(401);
  });

  test("valid gh but not mapped → 403", async () => {
    expect((await get("/whoami?namespace=acme", "tok-ghost")).status).toBe(403);
  });
});
