// Safe writes: write to a temp sibling then rename (atomic on the same fs).
// Mirrors the harny house pattern.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data, null, 2) + "\n");
}
