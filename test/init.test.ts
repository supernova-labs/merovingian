import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldTenant } from "../src/commands/init.ts";
import { loadGraphFile } from "../src/graph/load-graph.ts";
import { validateGraph } from "../src/graph/plan.ts";

test("init creates a valid graph without legacy or client-specific files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "new-tenant-"));
  try {
    const result = await scaffoldTenant("acme", {owner: "ada", github: "ada-example", targetDir: dir, noGit: true});
    expect(result.files.sort()).toEqual([".gitignore", "README.md", "graph.yaml", "merovingian.toml"]);
    const {definition, users} = loadGraphFile(join(dir, "graph.yaml"));
    expect(validateGraph(definition, users)).toEqual([]);
    expect(definition.ambient.instructions).toContain("authenticated identity");
    expect(users.ada?.journalAdmin).toBe(true);
    expect(definition.skillCatalog).toEqual({});
    expect(definition.agentByPurpose).toEqual({});
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain(".env");
    await expect(scaffoldTenant("acme", {owner: "ada", github: "ada-example", targetDir: dir, noGit: true})).rejects.toThrow("not empty");
  } finally { await rm(dir, {recursive: true, force: true}); }
});
test("init rejects paths used as tenant names", async () => {
  await expect(scaffoldTenant("../outside", {owner: "ada", github: "ada-example", noGit: true})).rejects.toThrow("slug");
});
