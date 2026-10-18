import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import {
  baselineGitignore,
  baselineGraphYaml,
  baselineMerovingianToml,
  baselineReadme,
} from "../init/baseline.ts";

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
  if (!/^[a-z][a-z0-9-]*$/.test(tenant)) throw new Error("tenant must be a lowercase slug");
  const dir = opts.targetDir ?? join(process.cwd(), tenant);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`"${dir}" already exists and is not empty — pick another name/folder`);
  }

  const files = [
    "graph.yaml",
    "merovingian.toml",
    "README.md",
    ".gitignore",
  ];
  await writeFileAtomic(join(dir, "graph.yaml"), baselineGraphYaml(tenant, opts.owner, opts.github));
  await writeFileAtomic(join(dir, "merovingian.toml"), baselineMerovingianToml());
  await writeFileAtomic(join(dir, "README.md"), baselineReadme(tenant));
  await writeFileAtomic(join(dir, ".gitignore"), baselineGitignore());

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
  console.log("Next: review graph.yaml and the connection, then run deploy plan and deploy apply.");
}
