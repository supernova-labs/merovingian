import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionDiagnostic } from "../src/commands/connection-diagnostic.ts";
import { surrealConfig } from "../src/provider/surreal.ts";
import { writeNamespace } from "../src/transport.ts";

const keys = ["SURREAL_URL", "SURREAL_NS", "SURREAL_DB", "SURREAL_USER", "SURREAL_PASS"];
describe("connection diagnostics", () => {
  test("resolution reports defaults, registry, environment and explicit overrides", async () => {
    const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    const home = mkdtempSync(join(tmpdir(), "mero-diagnostic-"));
    try {
      for (const k of keys) delete process.env[k];
      expect(surrealConfig("acme", {}, home).sources).toEqual({ url: "local default", ns: "default", db: "tenant argument", username: "development default", password: "development default" });
      await writeNamespace("acme", { transport: "surreal", url: "wss://example.test/rpc" }, home);
      expect(surrealConfig("acme", {}, home).sources?.url).toBe("machine registry");
      process.env.SURREAL_URL = "wss://env.example.test/rpc";
      process.env.SURREAL_PASS = "secret";
      expect(surrealConfig("acme", {}, home).sources?.url).toBe("SURREAL_URL (environment)");
      expect(surrealConfig("acme", { db: "other", url: "wss://override.test/rpc" }, home).sources?.db).toBe("explicit override");
    } finally {
      for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
      rmSync(home, { recursive: true, force: true });
    }
  });
  test("errors expose target and guidance, but no driver payload or credentials", () => {
    const cfg = { url: "wss://url-user:url-password@example.test/private-path?token=query-token#fragment", ns: "acme", db: "tenant", username: "admin", password: "system-secret", sources: { url: "machine registry", ns: "SURREAL_NS (environment)", db: "tenant argument", username: "SURREAL_USER (environment)", password: "development default" } };
    const error = new Error("driver reveals system-secret, personal-secret, bearer-token");
    for (const mode of ["operator", "personal"] as const) {
      const result = connectionDiagnostic(cfg, error, mode, "connect", { source: "explicit password option", password: "personal-secret" });
      expect(result.message).toContain("wss://example.test");
      expect(result.message).toContain('database "tenant"');
      expect(result.message).toContain('namespace "acme"');
      for (const label of ["machine registry", "SURREAL_NS (environment)", "tenant argument"]) expect(result.message).toContain(label);
      if (mode === "operator") for (const label of ["SURREAL_USER (environment)", "development default"]) expect(result.message).toContain(label);
      for (const secret of ["url-user", "url-password", "private-path", "query-token", "fragment", "system-secret", "personal-secret", "bearer-token"]) expect(result.message).not.toContain(secret);
      expect(result.cause).toBeUndefined();
      expect(result.message).toContain(mode === "operator" ? "root → namespace → database" : "Personal identity SIGNIN");
    }
  });
  test("successful authentication is not diagnosed as a password problem", () => {
    const cfg = { url: "wss://example.test/rpc", ns: "acme", db: "tenant", username: "admin", password: "secret" };
    const missing = connectionDiagnostic(cfg, null, "operator", "read", undefined, "user_missing");
    expect(missing.message).toContain("user not found");
    expect(missing.message).not.toContain("Database operation failed");
    expect(missing.message).not.toContain("network reachability");
    for (const stage of ["read", "write"] as const) {
      const error = connectionDiagnostic(cfg, new Error("query failed"), "personal", stage);
      expect(error.message).toContain("Authentication succeeded");
      expect(error.message).not.toContain("Check MEROVINGIAN_PASS");
    }
    expect(connectionDiagnostic(cfg, null, "personal", "read", undefined, "identity_missing").message).toContain("schema drift");
  });

});
