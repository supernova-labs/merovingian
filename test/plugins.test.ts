import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexPluginRequirements,
  inspectCodexPlugins,
  pluginsSync,
  type CodexRunner,
} from "../src/commands/plugins.ts";
import type { BuildStamp } from "../src/projection/emit.ts";

const roots: string[] = [];
afterAll(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function stamp(): BuildStamp {
  return {
    schemaVersion: 2,
    namespace: "acme",
    user: "ada",
    assignments: [],
    builders: {
      common: { version: 1, files: [".merovingian/build.json"] },
      claude: { version: 1, files: [] },
      codex: { version: 1, files: [] },
    },
    plugins: [
      {
        id: "review@company",
        claude: { source: "acme/claude-marketplace", name: "claude-company" },
        codex: { source: "acme/codex-marketplace", name: "codex-company" },
      },
      {
        id: "claude-only@legacy",
        claude: { source: "acme/legacy", name: "legacy" },
      },
    ],
  };
}

function workspace(value = stamp()): string {
  const root = mkdtempSync(join(tmpdir(), "merovingian-plugins-"));
  roots.push(root);
  mkdirSync(join(root, ".merovingian"));
  writeFileSync(join(root, ".merovingian", "build.json"), JSON.stringify(value));
  return root;
}

describe("Codex plugin reconciliation", () => {
  test("maps logical requirements through the Codex marketplace binding", () => {
    expect(codexPluginRequirements(stamp())).toEqual([
      {
        logicalId: "review@company",
        plugin: "review",
        marketplace: { source: "acme/codex-marketplace", name: "codex-company" },
        nativeId: "review@codex-company",
      },
    ]);
  });

  test("inspection reports disabled or absent plugins without failing the build", async () => {
    const runner: CodexRunner = async () => JSON.stringify({
      installed: [{ pluginId: "review@codex-company", enabled: false }],
    });
    const status = await inspectCodexPlugins(stamp(), runner);
    expect(status.missing.map((item) => item.nativeId)).toEqual(["review@codex-company"]);
    expect(status.unavailable).toBeUndefined();

    const unavailable = await inspectCodexPlugins(stamp(), async () => {
      throw new Error("codex is not installed");
    });
    expect(unavailable.missing).toEqual([]);
    expect(unavailable.unavailable).toContain("codex is not installed");
  });

  test("inspection accepts the installed native marketplace name when the Git source matches", async () => {
    const runner: CodexRunner = async () => JSON.stringify({
      installed: [{
        pluginId: "review@actual-marketplace",
        name: "review",
        enabled: true,
        marketplaceSource: { source: "https://github.com/acme/codex-marketplace.git" },
      }],
    });
    expect((await inspectCodexPlugins(stamp(), runner)).missing).toEqual([]);
  });

  test("sync adds missing marketplaces and plugins, with no Merovingian state file", async () => {
    const calls: string[][] = [];
    let marketplaceLists = 0;
    const runner: CodexRunner = async (args) => {
      calls.push(args);
      if (args.join(" ") === "plugin marketplace list --json") {
        marketplaceLists++;
        return JSON.stringify({
          marketplaces: marketplaceLists === 1
            ? []
            : [{
                name: "codex-company",
                marketplaceSource: { source: "acme/codex-marketplace" },
              }],
        });
      }
      if (args.join(" ") === "plugin list --json") {
        return JSON.stringify({ installed: [] });
      }
      return "{}";
    };

    const result = await pluginsSync(workspace(), runner);
    expect(result).toEqual({
      addedMarketplaces: ["codex-company"],
      installedPlugins: ["review@codex-company"],
      alreadyPresent: [],
    });
    expect(calls).toEqual([
      ["plugin", "marketplace", "list", "--json"],
      ["plugin", "marketplace", "add", "acme/codex-marketplace", "--json"],
      ["plugin", "marketplace", "list", "--json"],
      ["plugin", "list", "--json"],
      ["plugin", "add", "review@codex-company", "--json"],
    ]);
  });

  test("sync reuses a configured marketplace with the same Git source under its native name", async () => {
    const calls: string[][] = [];
    const runner: CodexRunner = async (args) => {
      calls.push(args);
      if (args.join(" ") === "plugin marketplace list --json") {
        return JSON.stringify({
          marketplaces: [{
            name: "actual-marketplace",
            marketplaceSource: { source: "https://github.com/acme/codex-marketplace.git" },
          }],
        });
      }
      if (args.join(" ") === "plugin list --json") return JSON.stringify({ installed: [] });
      return "{}";
    };
    const result = await pluginsSync(workspace(), runner);
    expect(result.installedPlugins).toEqual(["review@actual-marketplace"]);
    expect(result.addedMarketplaces).toEqual([]);
    expect(calls).not.toContainEqual([
      "plugin", "marketplace", "add", "acme/codex-marketplace", "--json",
    ]);
  });

  test("sync rejects a configured marketplace with the same name and another source", async () => {
    const runner: CodexRunner = async (args) => {
      if (args[1] === "marketplace") {
        return JSON.stringify({
          marketplaces: [{
            name: "codex-company",
            marketplaceSource: { source: "other/source" },
          }],
        });
      }
      return JSON.stringify({ installed: [] });
    };
    expect(pluginsSync(workspace(), runner)).rejects.toThrow(/already points to "other\/source"/);
  });
});
