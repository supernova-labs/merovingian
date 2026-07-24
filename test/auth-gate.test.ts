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
  connectAsPassword,
  signinIdentity,
  mintIdentityJwt,
  DEV_JWT_SECRET,
  provisioningSecret,
} from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { passwd } from "../src/commands/passwd.ts";
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

(dbUp ? describe : describe.skip)("password SIGNIN (the person's own credential)", () => {
  test("passwd sets the credential; signin authenticates and $auth resolves", async () => {
    await passwd("acme", "ada", { surrealDb: TEST_DB, password: "ada-password-1" });
    const db = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const [uid] = await db.query<[string]>("RETURN record::id($auth)");
      expect(uid).toBe("ada");
    } finally {
      await db.close();
    }
  });

  test("wrong password is rejected", async () => {
    await expect(signinIdentity(cfg, "ada", "wrong-password")).rejects.toThrow();
  });

  test("a user with NO credential cannot sign in", async () => {
    // the auth-gate db is reused across runs and reset PRESERVES credentials —
    // make the no-credential premise explicit instead of assuming history.
    const root = await connectSurreal(cfg);
    try {
      await root.query("DELETE credential WHERE record::id(id) = 'ben'");
    } finally {
      await root.close();
    }
    await expect(signinIdentity(cfg, "ben", "anything-at-all")).rejects.toThrow();
  });

  test("password login resolves the identity WITHOUT a system credential (closed user table)", async () => {
    // the user table is closed to record identities — even own-record fields don't
    // read back — so the login path takes the identity from $auth itself. This is
    // exactly the query the CLI login runs.
    const db = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const [uid] = await db.query<[string]>("RETURN record::id($auth)");
      expect(uid).toBe("ada");
    } finally {
      await db.close();
    }
  });

  test("the credential hash is invisible to a signed-in user", async () => {
    const db = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const [rows] = await db.query<[unknown[]]>("SELECT * FROM credential");
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("the signed-in session is subject to PERMISSIONS like any token", async () => {
    // the user table is CLOSED to record identities (schema.surql: no PERMISSIONS
    // clause = NONE): a password session scanning it must get ZERO rows — proof it
    // runs as a record identity, not a system user.
    const db = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const [rows] = await db.query<[unknown[]]>("SELECT * FROM user");
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("passwd rejects an unknown user and a too-short password", async () => {
    await expect(passwd("acme", "nobody", { surrealDb: TEST_DB, password: "long-enough-pw" })).rejects.toThrow(/not found/);
    await expect(passwd("acme", "ada", { surrealDb: TEST_DB, password: "short" })).rejects.toThrow(/too short/);
  });

  test("credentials SURVIVE a converge (deploy apply re-projects structure, never passwords)", async () => {
    const { definition, users } = loadGraphFile(EXAMPLE_YAML);
    const db = await connectSurreal(cfg);
    try {
      await applyGraph(db, definition, users, { reset: false });
    } finally {
      await db.close();
    }
    const again = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const [uid] = await again.query<[string]>("RETURN record::id($auth)");
      expect(uid).toBe("ada");
    } finally {
      await again.close();
    }
  });

  test("passwd rotation: old password stops working, new one signs in", async () => {
    await passwd("acme", "ada", { surrealDb: TEST_DB, password: "ada-password-2" });
    await expect(signinIdentity(cfg, "ada", "ada-password-1")).rejects.toThrow();
    const db = await connectAsPassword(cfg, "ada", "ada-password-2");
    try {
      const [uid] = await db.query<[string]>("RETURN record::id($auth)");
      expect(uid).toBe("ada");
    } finally {
      await db.close();
    }
  });
});
