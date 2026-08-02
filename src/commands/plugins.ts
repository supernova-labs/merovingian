// Explicit Codex plugin reconciliation (ADR 0017).
//
// `build` remains projection-only: it records the native plugin requirements in
// the workspace stamp and may inspect the current Codex installation for warnings.
// `plugins sync` is the opt-in mutating operation that adds marketplaces/plugins.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ReadableBuildStamp } from "../projection/emit.ts";

const execFileAsync = promisify(execFile);
const STAMP_PATH = ".merovingian/build.json";

export interface CodexPluginRequirement {
  logicalId: string;
  plugin: string;
  marketplace: { source: string; name: string };
  nativeId: string;
}

export interface CodexPluginStatus {
  missing: CodexPluginRequirement[];
  unavailable?: string;
}

interface InstalledPlugin {
  pluginId?: string;
  name?: string;
  enabled?: boolean;
  marketplaceSource?: { source?: string };
}

interface Marketplace {
  name?: string;
  marketplaceSource?: { source?: string };
}

export type CodexRunner = (args: string[]) => Promise<string>;

async function defaultRunner(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("codex", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function parseJson<T>(value: string, operation: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Codex returned invalid JSON while ${operation}`);
  }
}

function sourceKey(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

export function codexPluginRequirements(stamp: ReadableBuildStamp): CodexPluginRequirement[] {
  return stamp.plugins.flatMap((entry) => {
    if (!entry.codex) return [];
    const at = entry.id.lastIndexOf("@");
    if (at <= 0) throw new Error(`invalid plugin requirement "${entry.id}" in ${STAMP_PATH}`);
    const plugin = entry.id.slice(0, at);
    return [{
      logicalId: entry.id,
      plugin,
      marketplace: entry.codex,
      nativeId: `${plugin}@${entry.codex.name}`,
    }];
  });
}

export async function readBuildStamp(workspace = process.cwd()): Promise<ReadableBuildStamp> {
  const path = join(resolve(workspace), STAMP_PATH);
  if (!existsSync(path)) {
    throw new Error(`no ${STAMP_PATH} found — run merovingian build first`);
  }
  let stamp: ReadableBuildStamp;
  try {
    stamp = JSON.parse(await readFile(path, "utf8")) as ReadableBuildStamp;
  } catch {
    throw new Error(`${STAMP_PATH} is not valid JSON`);
  }
  if (
    ![2, 3].includes(stamp.schemaVersion) ||
    !Array.isArray(stamp.plugins) ||
    (stamp.schemaVersion === 3 && !Array.isArray(stamp.requestedPurposes))
  ) {
    throw new Error(`${STAMP_PATH} is not a multi-harness build stamp — run merovingian build again`);
  }
  return stamp;
}

export async function inspectCodexPlugins(
  stamp: ReadableBuildStamp,
  runner: CodexRunner = defaultRunner,
): Promise<CodexPluginStatus> {
  const required = codexPluginRequirements(stamp);
  if (!required.length) return { missing: [] };
  try {
    const listed = parseJson<{ installed?: InstalledPlugin[] }>(
      await runner(["plugin", "list", "--json"]),
      "listing plugins",
    );
    const enabled = (listed.installed ?? []).filter((plugin) => plugin.enabled !== false);
    return {
      missing: required.filter((requirement) => !enabled.some((plugin) =>
        plugin.pluginId === requirement.nativeId ||
        (
          plugin.name === requirement.plugin &&
          plugin.marketplaceSource?.source !== undefined &&
          sourceKey(plugin.marketplaceSource.source) === sourceKey(requirement.marketplace.source)
        )
      )),
    };
  } catch (error) {
    return {
      missing: [],
      unavailable: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface PluginSyncResult {
  addedMarketplaces: string[];
  installedPlugins: string[];
  alreadyPresent: string[];
}

export async function pluginsSync(
  workspace = process.cwd(),
  runner: CodexRunner = defaultRunner,
): Promise<PluginSyncResult> {
  const stamp = await readBuildStamp(workspace);
  const required = codexPluginRequirements(stamp);
  const listMarketplaces = async (): Promise<Marketplace[]> =>
    parseJson<{ marketplaces?: Marketplace[] }>(
      await runner(["plugin", "marketplace", "list", "--json"]),
      "listing marketplaces",
    ).marketplaces ?? [];
  let marketplaces = await listMarketplaces();

  const addedMarketplaces: string[] = [];
  const byMarketplace = new Map<string, CodexPluginRequirement>();
  for (const requirement of required) {
    const name = requirement.marketplace.name;
    const prior = byMarketplace.get(name);
    if (prior && sourceKey(prior.marketplace.source) !== sourceKey(requirement.marketplace.source)) {
      throw new Error(`Codex marketplace "${name}" has conflicting sources in ${STAMP_PATH}`);
    }
    byMarketplace.set(name, requirement);
  }

  const resolvedMarketplace = new Map<string, string>();
  const addedSources = new Set<string>();
  for (const [name, requirement] of [...byMarketplace].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = marketplaces.find((marketplace) => marketplace.name === name);
    const actualSource = existing?.marketplaceSource?.source;
    if (existing && actualSource && sourceKey(actualSource) !== sourceKey(requirement.marketplace.source)) {
      throw new Error(
        `Codex marketplace "${name}" already points to "${actualSource}", ` +
          `not "${requirement.marketplace.source}"`,
      );
    }
    if (existing) {
      resolvedMarketplace.set(name, name);
      continue;
    }
    const sameSource = marketplaces.find((marketplace) =>
      marketplace.name &&
      marketplace.marketplaceSource?.source &&
      sourceKey(marketplace.marketplaceSource.source) === sourceKey(requirement.marketplace.source)
    );
    if (sameSource?.name) {
      resolvedMarketplace.set(name, sameSource.name);
      continue;
    }
    if (!addedSources.has(sourceKey(requirement.marketplace.source))) {
      await runner(["plugin", "marketplace", "add", requirement.marketplace.source, "--json"]);
      addedSources.add(sourceKey(requirement.marketplace.source));
    }
  }

  if (addedSources.size) marketplaces = await listMarketplaces();
  for (const [name, requirement] of byMarketplace) {
    if (resolvedMarketplace.has(name)) continue;
    const configured = marketplaces.find((marketplace) =>
      marketplace.name &&
      (
        marketplace.name === name ||
        (
          marketplace.marketplaceSource?.source &&
          sourceKey(marketplace.marketplaceSource.source) === sourceKey(requirement.marketplace.source)
        )
      )
    );
    if (!configured?.name) {
      throw new Error(
        `Codex added marketplace source "${requirement.marketplace.source}" ` +
          `but did not expose a usable marketplace name`,
      );
    }
    resolvedMarketplace.set(name, configured.name);
    addedMarketplaces.push(configured.name);
  }

  const status = await inspectCodexPlugins(stamp, runner);
  if (status.unavailable) throw new Error(status.unavailable);
  const missing = new Set(status.missing.map((requirement) => requirement.logicalId));
  const installedPlugins: string[] = [];
  const alreadyPresent: string[] = [];
  for (const requirement of required.sort((a, b) => a.nativeId.localeCompare(b.nativeId))) {
    const nativeId = `${requirement.plugin}@${resolvedMarketplace.get(requirement.marketplace.name) ?? requirement.marketplace.name}`;
    if (!missing.has(requirement.logicalId)) {
      alreadyPresent.push(nativeId);
      continue;
    }
    await runner(["plugin", "add", nativeId, "--json"]);
    installedPlugins.push(nativeId);
  }
  return { addedMarketplaces, installedPlugins, alreadyPresent };
}
