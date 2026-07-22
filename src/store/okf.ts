// Materialize okf-repo buckets: clone/pull each entitled repo into the central
// store, then symlink it into ./context/<bucket> in the workspace. The repo's
// real path is also in additionalDirectories (emit), so the agent reads the real
// content *through* the link (probed: works).
//
// gh is the permission boundary (defense-in-depth): the clone runs with the
// user's gh creds, so a repo they can't access fails to clone. Fail-closed — the
// bucket simply doesn't materialize (no symlink, no context), never wrong content.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, symlink, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "../projection/resolve.ts";

const run = promisify(execFile);

export interface OkfResult {
  mounted: { bucket: string; path: string }[];
  denied: { bucket: string; repo: string; reason: string }[];
}

/** Clone (with the user's gh creds) or fast-forward an okf repo into the store. */
async function cloneOrPull(slug: string, dir: string): Promise<void> {
  if (existsSync(join(dir, ".git"))) {
    await run("git", ["-C", dir, "pull", "--ff-only", "--quiet"]);
    return;
  }
  await mkdir(dirname(dir), { recursive: true });
  // gh repo clone uses the local gh auth → this is the permission boundary.
  await run("gh", ["repo", "clone", slug, dir, "--", "--quiet"]);
}

/** Idempotent symlink ./context/<bucket> -> store path (lstat, so dangling links
 *  are refreshed too; a real dir in the way is left untouched and reported). */
async function linkContext(contextDir: string, bucket: string, target: string): Promise<void> {
  const link = join(contextDir, bucket);
  let st = null;
  try {
    st = await lstat(link);
  } catch {
    st = null;
  }
  if (st) {
    if (!st.isSymbolicLink()) throw new Error(`context/${bucket} already exists and is not a symlink — skipping`);
    await rm(link);
  }
  await symlink(target, link);
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && (e as { stderr?: unknown }).stderr) {
    return String((e as { stderr: unknown }).stderr).trim().split("\n").slice(-1)[0] ?? "";
  }
  return e instanceof Error ? e.message : String(e);
}

/** Clone/pull every entitled okf repo and symlink it into ./context. Per-repo
 *  failures are isolated (fail-closed) and returned in `denied`. Clones run
 *  SEQUENTIALLY — parallel `gh`/git races the credential helper (keyring isn't
 *  concurrency-safe) and fails with git exit 128. */
export async function materializeOkf(m: Manifest, targetDir: string): Promise<OkfResult> {
  const contextDir = join(targetDir, "context");
  const mounted: OkfResult["mounted"] = [];
  const denied: OkfResult["denied"] = [];
  if (m.okf.length) await mkdir(contextDir, { recursive: true });

  for (const o of m.okf) {
    try {
      await cloneOrPull(o.repo, o.path);
    } catch (e) {
      denied.push({ bucket: o.bucket, repo: o.repo, reason: errMsg(e) });
      continue; // fail-closed: don't symlink a repo we couldn't fetch
    }
    try {
      await linkContext(contextDir, o.bucket, o.path);
      mounted.push({ bucket: o.bucket, path: o.path });
    } catch (e) {
      denied.push({ bucket: o.bucket, repo: o.repo, reason: errMsg(e) });
    }
  }
  return { mounted, denied };
}
