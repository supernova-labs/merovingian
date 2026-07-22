// Per-tenant connection config — merovingian.toml + the machine registry.
// Pure filesystem tests (temp dirs stand in for the tenant repo and $HOME):
// toml parsing, the url resolution chain in surrealConfig, and the authoring-side
// registration that lets namespace-keyed commands find the right server.

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTenantConnection, connectionOverrides } from "../src/tenant-config.ts";
import { writeNamespace, remoteOptsFor, registeredSurrealUrl } from "../src/transport.ts";
import { surrealConfig } from "../src/provider/surreal.ts";
import { namespaceFile } from "../src/paths.ts";
import { baselineMerovingianToml } from "../src/init/baseline.ts";

let dir: string;
let home: string;
const savedUrl = process.env.SURREAL_URL;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mero-tenant-"));
  home = mkdtempSync(join(tmpdir(), "mero-home-"));
  delete process.env.SURREAL_URL;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (savedUrl === undefined) delete process.env.SURREAL_URL;
  else process.env.SURREAL_URL = savedUrl;
});

const toml = (body: string): void => writeFileSync(join(dir, "merovingian.toml"), body);

describe("loadTenantConnection (merovingian.toml)", () => {
  test("absent file → null (use the defaults)", () => {
    expect(loadTenantConnection(dir)).toBeNull();
  });

  test("the init template (all commented out) → null", () => {
    toml(baselineMerovingianToml());
    expect(loadTenantConnection(dir)).toBeNull();
  });

  test("a declared [surreal] url is read", () => {
    toml(`[surreal]\nurl = "ws://localhost:9019/rpc"\n`);
    expect(loadTenantConnection(dir)).toEqual({ url: "ws://localhost:9019/rpc" });
  });

  test("non-ws urls and malformed toml fail loudly", () => {
    toml(`[surreal]\nurl = "http://localhost:9019"\n`);
    expect(() => loadTenantConnection(dir)).toThrow(/ws:\/\/ or wss:\/\//);
    toml(`[surreal\nurl = broken`);
    expect(() => loadTenantConnection(dir)).toThrow(/not valid TOML/);
  });
});

describe("surrealConfig url resolution — overrides > env > registry > default", () => {
  test("no registry, no env → the docker default", () => {
    expect(surrealConfig("beta", {}, home).url).toBe("ws://localhost:8020/rpc");
  });

  test("a registered surreal url beats the default", async () => {
    await writeNamespace("beta", { transport: "surreal", url: "ws://localhost:9019/rpc" }, home);
    expect(surrealConfig("beta", {}, home).url).toBe("ws://localhost:9019/rpc");
  });

  test("env SURREAL_URL beats the registry; explicit overrides beat env", async () => {
    await writeNamespace("beta", { transport: "surreal", url: "ws://localhost:9019/rpc" }, home);
    process.env.SURREAL_URL = "ws://elsewhere:9000/rpc";
    expect(surrealConfig("beta", {}, home).url).toBe("ws://elsewhere:9000/rpc");
    expect(surrealConfig("beta", { url: "ws://explicit:1/rpc" }, home).url).toBe("ws://explicit:1/rpc");
  });

  test("a remote-transport entry is NOT a surreal url (registry keeps both shapes apart)", async () => {
    await writeNamespace("beta", { transport: "remote", url: "https://service.example" }, home);
    expect(registeredSurrealUrl("beta", home)).toBeNull();
    expect(surrealConfig("beta", {}, home).url).toBe("ws://localhost:8020/rpc");
  });
});

describe("remoteOptsFor — only remote entries are remote", () => {
  test("a surreal entry is served locally (undefined)", async () => {
    await writeNamespace("beta", { transport: "surreal", url: "ws://localhost:9019/rpc" }, home);
    expect(await remoteOptsFor("beta", home)).toBeUndefined();
  });
});

describe("connectionOverrides — the authoring-side registration", () => {
  test("no toml → no overrides, nothing registered", async () => {
    expect(await connectionOverrides(dir, "beta", home)).toEqual({});
    expect(registeredSurrealUrl("beta", home)).toBeNull();
  });

  test("a toml url is returned as override AND registered for the namespace", async () => {
    toml(`[surreal]\nurl = "ws://localhost:9019/rpc"\n`);
    expect(await connectionOverrides(dir, "beta", home)).toEqual({ url: "ws://localhost:9019/rpc" });
    expect(registeredSurrealUrl("beta", home)).toBe("ws://localhost:9019/rpc");
    expect(JSON.parse(readFileSync(namespaceFile("beta", home), "utf8"))).toEqual({
      transport: "surreal",
      url: "ws://localhost:9019/rpc",
    });
  });

  test("re-running with the same url is idempotent; a changed url re-registers", async () => {
    toml(`[surreal]\nurl = "ws://localhost:9019/rpc"\n`);
    await connectionOverrides(dir, "beta", home);
    await connectionOverrides(dir, "beta", home);
    toml(`[surreal]\nurl = "ws://localhost:8021/rpc"\n`);
    await connectionOverrides(dir, "beta", home);
    expect(registeredSurrealUrl("beta", home)).toBe("ws://localhost:8021/rpc");
  });
});
