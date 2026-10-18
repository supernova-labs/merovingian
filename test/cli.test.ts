import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../package.json";
import { parseArgs } from "../src/cli.ts";

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

describe("retired entrypoints", () => {
  test("rejects legacy commands instead of producing workspace files", () => {
    for (const command of ["build", "inbox", "decisions", "library", "plugins", "namespace"]) {
      expect(() => parseArgs([command, "acme"])).toThrow("unknown command");
    }
  });
  test("retired MCP servers cannot start", async () => {
    for (const server of ["inbox", "decisions"]) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../bin/merovingian.ts"), "mcp", server], {stdout: "pipe", stderr: "pipe"});
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited).not.toBe(0);
      expect(stderr).toContain("unknown mcp server");
      expect(await new Response(child.stdout).text()).toBe("");
    }
  });
});
