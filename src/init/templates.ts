// The Source's library templates (ADR 0012 §4/§5): the files `init` seeds into a new
// tenant's library/ and `library update` diffs against. Real files under
// src/init/templates/library — the repo itself is the distribution (same pattern as
// schema.surql in apply.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_ROOT = join(import.meta.dir, "templates/library");

/** Every template file, keyed by its path RELATIVE to library/ (e.g.
 *  "skills/journal/SKILL.md" -> content). */
export function readTemplateLibrary(root = TEMPLATES_ROOT): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out[rel] = readFileSync(abs, "utf8");
    }
  };
  walk(root, "");
  return out;
}
