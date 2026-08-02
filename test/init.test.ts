// `merovingian init` — offline scaffolding tests. The highest-value coverage: the
// baseline graph.yaml is provably schema-valid (loadGraphFile + validateGraph), and the
// committed settings.json is a LEAN config carrying NO token/env (guards a buildSettings leak).

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldTenant } from "../src/commands/init.ts";
import { loadGraphFile } from "../src/graph/load-graph.ts";
import { validateGraph } from "../src/graph/plan.ts";
import { MEROVINGIAN_MARKETPLACE, baselineWorkspaceInstructions } from "../src/init/baseline.ts";
import { readTemplateLibrary } from "../src/init/templates.ts";

const roots: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "merovingian-init-"));
  roots.push(d);
  return d;
}
afterAll(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("init scaffolding", () => {
  test("writes the baseline files", async () => {
    const dir = join(tmp(), "demo");
    const res = await scaffoldTenant("demo", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    expect(res.dir).toBe(dir);
    for (const f of ["graph.yaml", ".claude/settings.json", "README.md", ".gitignore", "library/workspace.md"]) {
      expect(existsSync(join(dir, f))).toBe(true);
      expect(res.files).toContain(f);
    }
  });

  test("the baseline graph.yaml is schema-valid and models the tenant + owner", async () => {
    const dir = join(tmp(), "acme");
    await scaffoldTenant("acme", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    const { definition, users } = loadGraphFile(join(dir, "graph.yaml"));
    expect(validateGraph(definition, users)).toEqual([]); // deployable
    expect(definition.namespace).toBe("acme");
    expect(definition.purposes.map((p) => p.id)).toEqual(["acme"]);
    expect(definition.ambient.skills).toEqual(["journal", "friction", "pending"]);
    expect(definition.ambient.instructions).toBe(baselineWorkspaceInstructions("acme").trim());
    expect(users.ada!.assignments).toEqual([{ purpose: "acme", role: "owner" }]);
    expect(users.ada!.github).toBe("ada-gh");
  });

  test("seeds the library — copies of the Source templates, self-contained (ADR 0012)", async () => {
    const dir = join(tmp(), "seeded");
    await scaffoldTenant("seeded", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    for (const f of [
      "library/agents/shell.md",
      "library/skills/journal/SKILL.md",
      "library/skills/journal/format.md",
      "library/skills/journal/context-gaps.md",
      "library/skills/friction/SKILL.md",
      "library/skills/route/SKILL.md",
    ]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    // seeds are exact copies of the templates
    const templates = readTemplateLibrary();
    expect(readFileSync(join(dir, "library/skills/journal/SKILL.md"), "utf8")).toBe(templates["skills/journal/SKILL.md"]!);
    // the baseline declares NO marketplace — a fresh tenant is fully self-contained
    const { definition } = loadGraphFile(join(dir, "graph.yaml"));
    expect(definition.marketplaces).toEqual({});
    expect(definition.agentByPurpose.seeded!.source).toBe("library");
  });

  test("seeds tenant-owned global guardrails outside the Source template catalog", async () => {
    const dir = join(tmp(), "guardrails");
    await scaffoldTenant("guardrails", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    const workspace = readFileSync(join(dir, "library/workspace.md"), "utf8");
    expect(workspace).toBe(baselineWorkspaceInstructions("guardrails"));
    expect(workspace).toContain("access boundaries");
    expect(workspace).toContain("ratified decisions");
    expect(workspace).toContain("credentials, secrets");
    expect(readTemplateLibrary()).not.toHaveProperty("workspace.md");
  });

  test("settings.json is lean — marketplace + plugin only, NO token/env (guards the leak)", async () => {
    const dir = join(tmp(), "lean");
    await scaffoldTenant("lean", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
    expect(s.extraKnownMarketplaces.merovingian.source).toEqual({ source: "github", repo: MEROVINGIAN_MARKETPLACE });
    expect(s.enabledPlugins["governance@merovingian"]).toBe(true);
    // must NOT carry the per-build cruft buildSettings injects
    expect(s).not.toHaveProperty("env");
    expect(s).not.toHaveProperty("permissions");
    expect(s).not.toHaveProperty("enableAllProjectMcpServers");
  });

  test("README names the tenant + the first-run approval note; gitignore covers node_modules", async () => {
    const dir = join(tmp(), "docs");
    await scaffoldTenant("docs", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("docs");
    expect(readme).toContain("First run");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
  });

  test("refuses to scaffold into a non-empty dir", async () => {
    const dir = join(tmp(), "taken");
    await scaffoldTenant("taken", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true });
    expect(scaffoldTenant("taken", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true })).rejects.toThrow(/already exists/);
  });
});
