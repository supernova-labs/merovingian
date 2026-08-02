import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../package.json";
import { parseArgs } from "../src/cli.ts";
import { normalizeRequestedPurposes } from "../src/commands/build.ts";

describe("version command", () => {
  test("accepts the command and conventional flag aliases", () => {
    for (const arg of ["version", "--version", "-v"]) {
      expect(parseArgs([arg])).toEqual({ command: "version" });
    }
  });

  test("prints the package version and exits successfully", async () => {
    for (const arg of ["version", "--version", "-v"]) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../bin/merovingian.ts"), arg], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`merovingian ${pkg.version}\n`);
      expect(stderr).toBe("");
    }
  });
});

describe("build purpose receipt", () => {
  test("normalizes the requested purpose roots without expanding them", () => {
    expect(normalizeRequestedPurposes(undefined)).toEqual([]);
    expect(normalizeRequestedPurposes([" growth ", "content", "growth", ""])).toEqual([
      "growth", "content",
    ]);
  });
});
