// The auth gate (#5): a tenant provisioned with a PRIVATE signing key rejects any
// token minted with the public dev key — the exact hole that data.surql's hardcoded
// KEY left open (anyone reading the repo could forge identities). Plus the unit gate
// that stops a real `deploy apply` from silently provisioning with the public key.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import {
  surrealConfig,
  surrealReachable,
  connectSurreal,
  connectWithToken,
  mintIdentityJwt,
  DEV_JWT_SECRET,
  provisioningSecret,
} from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { applyGraph } from "../src/graph/apply.ts";
import { loadGraphFile } from "../src/graph/load-graph.ts";

const TEST_DB = "acme_authgate";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });
// A private per-tenant secret — deliberately NOT the public dev key.
const REAL_SECRET = "private-tenant-secret-do-not-commit-0000";

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.MEROVINGIAN_JWT_SECRET;
  if (value === undefined) delete process.env.MEROVINGIAN_JWT_SECRET;
  else process.env.MEROVINGIAN_JWT_SECRET = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.MEROVINGIAN_JWT_SECRET;
    else process.env.MEROVINGIAN_JWT_SECRET = prev;
  }
}

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  // Provision the throwaway tenant with the PRIVATE key (env wins over the dev fallback).
  const prev = process.env.MEROVINGIAN_JWT_SECRET;
  process.env.MEROVINGIAN_JWT_SECRET = REAL_SECRET;
  try {
    await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  } finally {
    if (prev === undefined) delete process.env.MEROVINGIAN_JWT_SECRET;
    else process.env.MEROVINGIAN_JWT_SECRET = prev;
  }
}

describe("provisioningSecret — the deploy-apply gate", () => {
  test("real provisioning with no secret THROWS (can't silently ship the public key)", () => {
    withEnv(undefined, () => {
      expect(() => provisioningSecret(false)).toThrow(/MEROVINGIAN_JWT_SECRET is required/);
    });
  });

  test("dev/test provisioning (reset) may fall back to the public dev key", () => {
    withEnv(undefined, () => {
      expect(provisioningSecret(true)).toBe(DEV_JWT_SECRET);
    });
  });

  test("an explicit secret always wins over the dev fallback", () => {
    withEnv("a-real-secret", () => {
      expect(provisioningSecret(false)).toBe("a-real-secret");
      expect(provisioningSecret(true)).toBe("a-real-secret");
    });
  });

  test("the public dev key set as a 'private' secret is rejected for a real tenant", () => {
    withEnv(DEV_JWT_SECRET, () => {
      expect(() => provisioningSecret(false)).toThrow(/PUBLIC dev key/);
      expect(provisioningSecret(true)).toBe(DEV_JWT_SECRET); // dev/test may use it
    });
  });

  test("an empty secret is treated as unset (not a valid key)", () => {
    withEnv("", () => {
      expect(() => provisioningSecret(false)).toThrow(/required/);
      expect(provisioningSecret(true)).toBe(DEV_JWT_SECRET);
    });
  });
});

(dbUp ? describe : describe.skip)("a private-keyed tenant rejects dev-key tokens", () => {
  test("the PUBLIC dev key is rejected — the closed hole", async () => {
    const forged = mintIdentityJwt(cfg, "ada", DEV_JWT_SECRET);
    await expect(connectWithToken(cfg, forged)).rejects.toThrow();
  });

  test("the tenant's private key is accepted and resolves $auth", async () => {
    const token = mintIdentityJwt(cfg, "ada", REAL_SECRET);
    const db = await connectWithToken(cfg, token);
    try {
      const [uid] = await db.query<[string]>("RETURN record::id($auth)");
      expect(uid).toBe("ada");
    } finally {
      await db.close();
    }
  });

  test("a routine converge does NOT re-key the access (no silent token invalidation)", async () => {
    const { definition, users } = loadGraphFile(EXAMPLE_YAML);
    const db = await connectSurreal(cfg);
    // A converge running with a DRIFTED env secret must leave the existing KEY intact.
    const prev = process.env.MEROVINGIAN_JWT_SECRET;
    process.env.MEROVINGIAN_JWT_SECRET = "a-drifted-secret-from-a-stale-env";
    try {
      await applyGraph(db, definition, users, { reset: false });
    } finally {
      if (prev === undefined) delete process.env.MEROVINGIAN_JWT_SECRET;
      else process.env.MEROVINGIAN_JWT_SECRET = prev;
      await db.close();
    }
    // the ORIGINAL private key still works — the drifted apply did not re-key.
    const ok = await connectWithToken(cfg, mintIdentityJwt(cfg, "ada", REAL_SECRET));
    await ok.close();
    // and the drifted secret is NOT trusted.
    await expect(
      connectWithToken(cfg, mintIdentityJwt(cfg, "ada", "a-drifted-secret-from-a-stale-env")),
    ).rejects.toThrow();
  });
});
