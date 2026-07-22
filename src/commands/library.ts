// `merovingian library update [--graph P] [--yes]` — refresh the tenant's seeded
// library files from the Source templates (ADR 0012 §5). Audit-first, house style:
// without --yes it only shows the diff; --yes overwrites. It touches ONLY paths that
// exist in the templates — tenant-authored skills/agents/files are never considered.
//
// The command cannot tell "the tenant evolved this" from "this is stale" (provenance
// markers are roadmap) — git is the safety net: the overwrite lands as a reviewable,
// revertible working-tree diff in the tenant repo.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../fs/atomic.ts";
import { resolveGraphPath } from "../graph/load-graph.ts";
import { readTemplateLibrary } from "../init/templates.ts";

export type LibraryUpdateStatus = "in-sync" | "drift" | "applied";
export interface LibraryUpdateResult {
  status: LibraryUpdateStatus;
  /** template-relative paths (under library/) */
  add: string[];
  overwrite: string[];
  unchanged: string[];
}

export interface LibraryUpdateOpts {
  graph?: string;
  yes?: boolean;
}

export async function libraryUpdate(opts: LibraryUpdateOpts = {}): Promise<LibraryUpdateResult> {
  const tenantDir = dirname(resolveGraphPath(opts.graph));
  const templates = readTemplateLibrary();

  const add: string[] = [];
  const overwrite: string[] = [];
  const unchanged: string[] = [];
  for (const [rel, content] of Object.entries(templates).sort(([a], [b]) => a.localeCompare(b))) {
    const target = join(tenantDir, "library", rel);
    if (!existsSync(target)) add.push(rel);
    else if (readFileSync(target, "utf8") !== content) overwrite.push(rel);
    else unchanged.push(rel);
  }

  const dirty = add.length + overwrite.length > 0;
  if (dirty && opts.yes) {
    for (const rel of [...add, ...overwrite]) {
      await writeFileAtomic(join(tenantDir, "library", rel), templates[rel]!);
    }
    return { status: "applied", add, overwrite, unchanged };
  }
  return { status: dirty ? "drift" : "in-sync", add, overwrite, unchanged };
}

export function renderLibraryUpdate(r: LibraryUpdateResult): void {
  console.log(`library update  (template-owned paths only — your own files are never touched)\n`);
  for (const p of r.add) console.log(`  + add       library/${p}`);
  for (const p of r.overwrite) console.log(`  ~ overwrite library/${p}`);
  for (const p of r.unchanged) console.log(`  = unchanged library/${p}`);
  if (r.status === "in-sync") {
    console.log(`\n✓ library in sync with the Source templates.`);
  } else if (r.status === "drift") {
    console.log(
      `\n⚠ ${r.add.length + r.overwrite.length} file(s) differ — nothing was written. ` +
        `Re-run with --yes to apply (overwrites local edits to these files; git is your safety net).`,
    );
  } else {
    console.log(`\n✓ applied: +${r.add.length} added · ~${r.overwrite.length} overwritten. Review with git diff.`);
  }
}
