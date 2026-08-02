// The passive update notice: pure version compare, command gating, and the
// cache-or-fetch decision (TTL, refresh, fail-silent). No network — the fetcher
// is injected; the real one only runs inside startUpdateCheck.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isNewer, checksUpdates, latestVersion } from "../src/update-check.ts";

describe("isNewer", () => {
  test("orders numerically, not lexically", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });
  test("equal or older is not newer", () => {
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });
  test("unparseable input never notifies", () => {
    expect(isNewer("0.3.0-beta.1", "0.2.0")).toBe(false);
    expect(isNewer("banana", "0.2.0")).toBe(false);
    expect(isNewer("0.3", "0.2.0")).toBe(false);
    expect(isNewer("0.3.", "0.2.0")).toBe(false); // Number("") is 0 — must not pass as 0.3.0
    expect(isNewer("1.2.3.4", "0.2.0")).toBe(false);
  });
});

describe("checksUpdates", () => {
  test("mcp (stdout = protocol), console (never exits), help and version are excluded", () => {
    expect(checksUpdates("mcp")).toBe(false);
    expect(checksUpdates("console")).toBe(false);
    expect(checksUpdates("help")).toBe(false);
    expect(checksUpdates("version")).toBe(false);
  });
  test("member-facing commands are included", () => {
    for (const c of ["login", "build", "graph", "deploy", "passwd"]) {
      expect(checksUpdates(c)).toBe(true);
    }
  });
});

describe("latestVersion (cache-or-fetch)", () => {
  const NOW = Date.parse("2026-07-26T12:00:00Z");
  const fetchedVersions: string[] = [];
  const fetcher = (v: string | null) => async () => {
    if (v) fetchedVersions.push(v);
    return v;
  };

  async function freshFile(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "mero-update-")), "update-check.json");
  }

  test("no cache → fetches and writes the cache", async () => {
    const file = await freshFile();
    expect(await latestVersion(file, NOW, fetcher("0.3.0"))).toBe("0.3.0");
    const cache = JSON.parse(await readFile(file, "utf8"));
    expect(cache.latest).toBe("0.3.0");
    expect(Date.parse(cache.checkedAt)).toBe(NOW);
  });

  test("fresh cache → no fetch", async () => {
    const file = await freshFile();
    await writeFile(file, JSON.stringify({ checkedAt: new Date(NOW - 1000).toISOString(), latest: "0.3.0" }));
    const before = fetchedVersions.length;
    expect(await latestVersion(file, NOW, fetcher("9.9.9"))).toBe("0.3.0");
    expect(fetchedVersions.length).toBe(before);
  });

  test("stale cache → refetches and refreshes", async () => {
    const file = await freshFile();
    await writeFile(file, JSON.stringify({ checkedAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(), latest: "0.2.5" }));
    expect(await latestVersion(file, NOW, fetcher("0.3.0"))).toBe("0.3.0");
    expect(JSON.parse(await readFile(file, "utf8")).latest).toBe("0.3.0");
  });

  test("fetch failure (offline) → null, and the stale cache is left alone", async () => {
    const file = await freshFile();
    const stale = { checkedAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(), latest: "0.2.5" };
    await writeFile(file, JSON.stringify(stale));
    expect(await latestVersion(file, NOW, fetcher(null))).toBe(null);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(stale);
  });

  test("future-dated cache (clock change) → not fresh, refetches", async () => {
    const file = await freshFile();
    await writeFile(file, JSON.stringify({ checkedAt: new Date(NOW + 60 * 60 * 1000).toISOString(), latest: "0.2.5" }));
    expect(await latestVersion(file, NOW, fetcher("0.3.0"))).toBe("0.3.0");
    expect(JSON.parse(await readFile(file, "utf8")).latest).toBe("0.3.0");
  });

  test("corrupt cache → treated as missing, refetches", async () => {
    const file = await freshFile();
    await writeFile(file, "not json{{{");
    expect(await latestVersion(file, NOW, fetcher("0.3.0"))).toBe("0.3.0");
  });
});
