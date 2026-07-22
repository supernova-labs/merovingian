// `merovingian init <tenant> --owner <id> --github <login>` — scaffold a new tenant
// repo (roadmap II.2 + ADR 0012). Files-only: writes a minimal-but-valid graph.yaml,
// SEEDS the library (journal/friction/route/shell — copies, the tenant's to evolve),
// the committed .claude/settings.json (governance plugin via the merovingian
// marketplace), README + .gitignore, then `git init`. Does NOT provision the db —
// that's a separate `deploy apply` step (which bootstraps a virgin db by itself).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../fs/atomic.ts";
import { baselineGitignore, baselineGraphYaml, baselineMerovingianToml, baselineReadme, baselineSettings } from "../init/baseline.ts";
import { readTemplateLibrary } from "../init/templates.ts";

export interface InitOpts {
  owner: string;
  github: string;
  /** where to scaffold; defaults to <cwd>/<tenant> */
  targetDir?: string;
  /** skip `git init` (tests) */
  noGit?: boolean;
}

export interface InitResult {
  dir: string;
  files: string[];
}

/** Scaffold the tenant repo. Returns the dir + the files written. */
export async function scaffoldTenant(tenant: string, opts: InitOpts): Promise<InitResult> {
  const dir = opts.targetDir ?? join(process.cwd(), tenant);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`"${dir}" already exists and is not empty — pick another name/folder`);
  }

  const files = ["graph.yaml", "merovingian.toml", ".claude/settings.json", "README.md", ".gitignore"];
  await writeFileAtomic(join(dir, "graph.yaml"), baselineGraphYaml(tenant, opts.owner, opts.github));
  await writeFileAtomic(join(dir, "merovingian.toml"), baselineMerovingianToml());
  await writeJsonAtomic(join(dir, ".claude/settings.json"), baselineSettings());
  await writeFileAtomic(join(dir, "README.md"), baselineReadme(tenant));
  await writeFileAtomic(join(dir, ".gitignore"), baselineGitignore());

  // seed the library — COPIES from the Source templates (ADR 0012 §4): the tenant
  // owns them from here on. `merovingian library update` pulls newer templates.
  for (const [rel, content] of Object.entries(readTemplateLibrary())) {
    const target = join("library", rel);
    await writeFileAtomic(join(dir, target), content);
    files.push(target);
  }

  if (!opts.noGit) {
    const p = Bun.spawn(["git", "init"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
    await p.exited;
  }

  return { dir, files };
}

export async function init(tenant: string, opts: InitOpts): Promise<void> {
  // announce the target BEFORE creating it — init makes a NEW subfolder and that
  // must never surprise the operator.
  const dir = opts.targetDir ?? join(process.cwd(), tenant);
  console.log(`creating ${dir}/ (the tenant repo)`);
  const { files } = await scaffoldTenant(tenant, { ...opts, targetDir: dir });
  for (const f of files) console.log(`  + ${f}`);
  console.log(
    `\nnext:\n` +
      `  1. cd ${tenant} && review graph.yaml + library/ (the seeded skills/agents are yours to evolve)\n` +
      `  2. open in Claude Code → approve the "merovingian" marketplace + "governance" plugin when prompted\n` +
      `  3. merovingian deploy plan   (audit)   ·   merovingian deploy apply   (first-run converge, needs SurrealDB)`,
  );
}
