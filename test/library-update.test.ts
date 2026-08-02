// `merovingian library update` — offline tests. Audit-first: shows the diff, --yes
// applies; touches ONLY template-owned paths (tenant-authored files never considered).

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldTenant } from "../src/commands/init.ts";
import { libraryUpdate } from "../src/commands/library.ts";
import { readTemplateLibrary } from "../src/init/templates.ts";

const roots: string[] = [];
function tenantDir(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "merovingian-libup-"));
  roots.push(root);
  const dir = join(root, "t");
  return scaffoldTenant("t", { owner: "ada", github: "ada-gh", targetDir: dir, noGit: true }).then(() => dir);
}
afterAll(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("library update", () => {
  test("fresh scaffold is in sync (exit-0 path)", async () => {
    const dir = await tenantDir();
    const r = await libraryUpdate({ graph: join(dir, "graph.yaml") });
    expect(r.status).toBe("in-sync");
    expect(r.add).toEqual([]);
    expect(r.overwrite).toEqual([]);
    expect(r.unchanged.length).toBeGreaterThan(0);
  });

  test("a locally-edited seed shows as drift; --yes overwrites it", async () => {
    const dir = await tenantDir();
    const edited = join(dir, "library/skills/journal/SKILL.md");
    writeFileSync(edited, "# my evolved journal\n");
    const audit = await libraryUpdate({ graph: join(dir, "graph.yaml") });
    expect(audit.status).toBe("drift");
    expect(audit.overwrite).toEqual(["skills/journal/SKILL.md"]);
    // audit-first: nothing written yet
    expect(readFileSync(edited, "utf8")).toBe("# my evolved journal\n");

    const applied = await libraryUpdate({ graph: join(dir, "graph.yaml"), yes: true });
    expect(applied.status).toBe("applied");
    expect(readFileSync(edited, "utf8")).toBe(readTemplateLibrary()["skills/journal/SKILL.md"]!);
  });

  test("a deleted seed shows as add; tenant-authored files are never touched", async () => {
    const dir = await tenantDir();
    rmSync(join(dir, "library/skills/update-workspace"), { recursive: true, force: true });
    mkdirSync(join(dir, "library/skills/my-own"), { recursive: true });
    writeFileSync(join(dir, "library/skills/my-own/SKILL.md"), "# mine\n");
    writeFileSync(join(dir, "library/workspace.md"), "# tenant-owned\n\nNever overwrite this.\n");

    const r = await libraryUpdate({ graph: join(dir, "graph.yaml"), yes: true });
    expect(r.add).toEqual(["skills/update-workspace/SKILL.md"]);
    expect(existsSync(join(dir, "library/skills/update-workspace/SKILL.md"))).toBe(true);
    // the tenant's own skill is invisible to the command
    expect([...r.add, ...r.overwrite, ...r.unchanged]).not.toContain("skills/my-own/SKILL.md");
    expect([...r.add, ...r.overwrite, ...r.unchanged]).not.toContain("workspace.md");
    expect(readFileSync(join(dir, "library/skills/my-own/SKILL.md"), "utf8")).toBe("# mine\n");
    expect(readFileSync(join(dir, "library/workspace.md"), "utf8")).toBe("# tenant-owned\n\nNever overwrite this.\n");
  });
});
