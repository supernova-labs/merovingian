// Passive update notice (the gh/bun pattern): after a command finishes, one line
// on stderr if the npm registry has a newer version. Never blocks, never breaks a
// command — any failure (offline, timeout, bad cache) silently disables it. The
// registry is consulted at most once per TTL via a cache file; the fetch runs
// concurrently with the command, so the notice costs no wall-clock in practice.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pkg from "../package.json";

const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

/** ~/.merovingian/update-check.json — machine-wide (not per-namespace). */
export function cacheFile(home = homedir()): string {
  return join(home, ".merovingian", "update-check.json");
}

interface Cache {
  checkedAt: string;
  latest: string;
}

/** Strict semver "a > b" — good for our x.y.z releases; anything unparseable is "not newer". */
export function isNewer(a: string, b: string): boolean {
  const SEMVER = /^\d+\.\d+\.\d+$/;
  if (!SEMVER.test(a) || !SEMVER.test(b)) return false;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]!;
  }
  return false;
}

/** Commands where the notice must never appear: mcp owns stdout (stdio protocol,
 *  and the process is a long-running server), console never exits, help should
 *  stay instant and side-effect-free. */
export function checksUpdates(command: string): boolean {
  return command !== "mcp" && command !== "console" && command !== "help" && command !== "version";
}

function optedOut(env = process.env): boolean {
  return Boolean(env.MEROVINGIAN_NO_UPDATE_CHECK || env.CI);
}

async function readCache(file: string): Promise<Cache | null> {
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as Cache;
    return typeof c.checkedAt === "string" && typeof c.latest === "string" ? c : null;
  } catch {
    return null;
  }
}

async function fetchLatest(): Promise<string | null> {
  const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : null;
}

/** Resolve the latest published version: fresh cache wins; otherwise ask the
 *  registry and refresh the cache. Null = don't notify (offline, opt-out, …). */
export async function latestVersion(
  file: string,
  now: number,
  fetcher: () => Promise<string | null> = fetchLatest,
): Promise<string | null> {
  const cached = await readCache(file);
  // future-dated checkedAt (clock change) = corrupt: refetch instead of staying "fresh" forever
  const age = cached ? now - Date.parse(cached.checkedAt) : NaN;
  if (cached && age >= 0 && age < TTL_MS) return cached.latest;
  const latest = await fetcher();
  if (!latest) return null;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify({ checkedAt: new Date(now).toISOString(), latest } satisfies Cache, null, 2));
  return latest;
}

/** Kick off the check (call BEFORE the command runs — it overlaps the real work). */
export function startUpdateCheck(command: string): Promise<string | null> {
  if (!checksUpdates(command) || optedOut()) return Promise.resolve(null);
  return latestVersion(cacheFile(), Date.now()).catch(() => null);
}

/** Await the pending check and print the one-line notice if there is one. */
export async function notifyUpdate(pending: Promise<string | null>): Promise<void> {
  const latest = await pending;
  if (latest && isNewer(latest, pkg.version)) {
    console.error(`\n↑ merovingian ${latest} available (you have ${pkg.version}) — bun add -g ${pkg.name}@latest`);
  }
}
