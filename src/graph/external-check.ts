// External existence checks for `deploy plan` (roadmap I.3, ADR 0009 §Cuidados#1).
// Best-effort, read-only: does every gh repo the desired graph references actually
// exist? Covers okf-repo bucket repos + marketplace repos. If `gh` is unavailable
// (not installed / not authed) the whole check is SKIPPED, not failed — the
// deterministic Surreal diff is the spine; this is a bonus signal.
//
// Deeper "does the marketplace CONTAIN plugin X" introspection is deferred — it's
// born with the marketplace provider (roadmap), when apply reaches gh.

import type { Definition } from "../provider/types.ts";

export interface ExternalCheck {
  skipped: boolean;
  reason?: string;
  repos: { repo: string; kind: "kb" | "marketplace"; exists: boolean }[];
}

/** True if the `gh` CLI is on PATH and authenticated. */
async function ghReady(): Promise<boolean> {
  try {
    const p = Bun.spawn(["gh", "auth", "status"], { stdout: "ignore", stderr: "ignore" });
    return (await p.exited) === 0;
  } catch {
    return false;
  }
}

async function repoExists(repo: string): Promise<boolean> {
  try {
    const p = Bun.spawn(["gh", "repo", "view", repo], { stdout: "ignore", stderr: "ignore" });
    return (await p.exited) === 0;
  } catch {
    return false;
  }
}

export async function checkExternal(def: Definition): Promise<ExternalCheck> {
  if (!(await ghReady())) return { skipped: true, reason: "gh unavailable or not authenticated", repos: [] };

  const targets: { repo: string; kind: "kb" | "marketplace" }[] = [];
  const seen = new Set<string>();
  for (const b of def.buckets) {
    if (b.backend === "okf-repo" && b.repo && !seen.has(b.repo)) {
      seen.add(b.repo);
      targets.push({ repo: b.repo, kind: "kb" });
    }
  }
  for (const marketplace of Object.values(def.marketplaces)) {
    for (const binding of [marketplace.claude, marketplace.codex]) {
      const repo = binding?.source;
      // gh repo view only understands GitHub owner/repo coordinates. Codex may
      // legitimately use a local path or another Git URL.
      if (repo && /^[^/]+\/[^/]+$/.test(repo) && !seen.has(repo)) {
        seen.add(repo);
        targets.push({ repo, kind: "marketplace" });
      }
    }
  }

  const repos = await Promise.all(
    targets.map(async (t) => ({ ...t, exists: await repoExists(t.repo) })),
  );
  return { skipped: false, repos };
}
