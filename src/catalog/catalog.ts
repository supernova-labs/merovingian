import { createHash } from "node:crypto";
import type { Definition, User } from "../provider/types.ts";
import { resolve } from "../projection/resolve.ts";

export type CatalogClient = "claude" | "codex";
export class CatalogError extends Error {
  constructor(public readonly code: "invalid_request" | "invalid_credentials" | "access_denied" | "invalid_configuration" | "unavailable", message: string) {
    super(message);
  }
}
const sorted = (items: string[]) => [...new Set(items)].sort();
const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Stable JSON: object insertion order is not a publication revision. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const revisionOf = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

/** Public, explicit allowlist. Never serialize Manifest, tool env/args, or library. */
export function resolveCatalog(def: Definition, user: User, client?: CatalogClient) {
  if (client !== undefined && client !== "claude" && client !== "codex") {
    throw new CatalogError("invalid_request", "Unsupported client.");
  }
  if (!user.assignments.length) throw new CatalogError("access_denied", "No purpose assignments are available for this identity.");
  // Resolve access with the existing rules, without parsing legacy prompt bodies or
  // resolving environment values. Library references are migration diagnostics only.
  const safeDefinition: Definition = {
    ...def,
    skillCatalog: Object.fromEntries(Object.entries(def.skillCatalog).filter(([, ref]) => ref.source === "plugin")),
    agentByPurpose: Object.fromEntries(Object.entries(def.agentByPurpose).filter(([, ref]) => ref.source === "plugin")),
    toolCatalog: {},
  };
  const manifest = resolve(safeDefinition, user, { storeRoot: "" });
  const visible = new Set(manifest.visiblePurposes);
  const pluginsFor = (purpose: Definition["purposes"][number]) => sorted([
    ...purpose.skills.flatMap(id => {
      const ref = def.skillCatalog[id];
      return ref?.source === "plugin" ? [`${ref.plugin}@${ref.marketplace}`] : [];
    }),
    ...(def.agentByPurpose[purpose.id]?.source === "plugin" ? (() => {
      const ref = def.agentByPurpose[purpose.id];
      return ref?.source === "plugin" ? [`${ref.plugin}@${ref.marketplace}`] : [];
    })() : []),
  ]);
  const purposes = def.purposes.filter(p => visible.has(p.id)).sort((a, b) => a.id.localeCompare(b.id)).map(p => ({
    id: p.id, reason: p.reason, parent: p.parent && visible.has(p.parent) ? p.parent : null,
    plugins: pluginsFor(p), tools: sorted(p.tools), owns: sorted(p.owns), reads: sorted(p.reads),
  }));
  const marketplaces = Object.entries(manifest.marketplaces).sort(([a], [b]) => a.localeCompare(b)).map(([id, m]) => ({
    id,
    bindings: (["claude", "codex"] as const).filter(c => !client || c === client).map(c => {
      const binding = m[c];
      // Local server paths and credential-bearing URLs are not distribution IDs.
      if (!binding || !slug.test(binding.source)) return { client: c, status: "unsupported" as const };
      return { client: c, status: "available" as const, name: binding.name, source: binding.source };
    }),
  }));
  const repositories = manifest.okf.map(r => {
    if (!slug.test(r.repo)) throw new CatalogError("invalid_configuration", "A repository needs an owner/name distribution identifier.");
    return { id: r.bucket, repository: r.repo, access: r.writable ? "write" as const : "read" as const, effectiveAccess: "not_verified" as const };
  });
  const tools = manifest.tools.map(id => {
    const t = def.toolCatalog[id];
    return t ? { id, kind: t.kind, status: "declared" as const, configuration: "out_of_band" as const,
      requiredEnvironment: Object.keys(t.env).sort(), credentialSource: t.keySource }
      : { id, status: "unavailable" as const };
  });
  const legacySkills = sorted([...def.ambient.skills, ...def.purposes.filter(p => visible.has(p.id)).flatMap(p => p.skills)])
    .filter(id => def.skillCatalog[id]?.source !== "plugin");
  const content = {
    apiVersion: 1 as const, tenant: def.namespace,
    identity: { id: user.id, name: user.name, ...(user.github ? { github: user.github } : {}),
      ...(user.email ? { email: user.email } : {}), ...(user.slackId ? { slackId: user.slackId } : {}) },
    assignments: [...user.assignments].map(a => ({ purpose: a.purpose, role: a.role, ...(a.scope ? { scope: a.scope } : {}) }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
    purposes, repositories, marketplaces,
    plugins: manifest.plugins.map(id => ({ id, versionStatus: "not_verified" as const })), tools,
    instructions: def.ambient.instructions ?? "",
    diagnostics: legacySkills.length ? [{ code: "undistributed_skills", resources: legacySkills }] : [],
  };
  return { ...content, revision: revisionOf(content) };
}
export type Catalog = ReturnType<typeof resolveCatalog>;
