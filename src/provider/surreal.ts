// SurrealProvider — the real DefinitionProvider (path B). Reads the structure
// back out of SurrealDB and reassembles the Definition. Lives behind the build
// service; same interface as the stub, so the projection is source-agnostic.

import { createHmac } from "node:crypto";
import { Surreal, RecordId } from "surrealdb";
import { registeredSurrealUrl } from "../transport.ts";
import type { DefinitionProvider, Definition, DecisionDef, Purpose, Bucket, User, ToolDef, SkillRef, AgentRef, AssignmentRow, Role } from "./types.ts";

/** The PUBLIC dev signing key — matches auth.surql's DEFINE ACCESS when a tenant is
 *  provisioned in dev/test. It is committed and world-readable ON PURPOSE: a token
 *  signed with it is only ever accepted by a dev/test DB (the compose :8020, fixtures
 *  only). A real tenant is provisioned with a PRIVATE secret (MEROVINGIAN_JWT_SECRET)
 *  and rejects dev-key tokens by construction. Never let this reach a real tenant's KEY. */
export const DEV_JWT_SECRET = "merovingian-dev-secret-change-me";

/** The JWT signing secret from the env, treating empty/unset alike as "no secret" — so a
 *  blank MEROVINGIAN_JWT_SECRET can't silently diverge minting (`?? DEV`) from provisioning
 *  (`if truthy`) and leave a tenant that rejects its own tokens. The one source both use. */
export function envJwtSecret(): string | undefined {
  return process.env.MEROVINGIAN_JWT_SECRET || undefined;
}

/** The secret a tenant's identity DEFINE ACCESS is provisioned to trust (auth.surql).
 *  Prod: MEROVINGIAN_JWT_SECRET (private, held only by the build/auth service). The
 *  public dev key is used ONLY when explicitly allowed — dev/test provisioning via
 *  `reset`. A real `deploy apply` with no secret THROWS rather than silently minting a
 *  tenant whose identities anyone reading this repo could forge — and it refuses the
 *  public dev key even if set explicitly (that would defeat the whole separation). */
export function provisioningSecret(allowDevKey: boolean): string {
  const s = envJwtSecret();
  if (s) {
    if (s === DEV_JWT_SECRET && !allowDevKey) {
      throw new Error(
        "MEROVINGIAN_JWT_SECRET is the PUBLIC dev key — a real tenant needs a PRIVATE secret.\n" +
          "  Generate one with `openssl rand -hex 32`. (The dev key exists for this repo's own test suite.)",
      );
    }
    return s;
  }
  if (allowDevKey) return DEV_JWT_SECRET;
  throw new Error(
    "MEROVINGIAN_JWT_SECRET is required to provision identity access on a real tenant.\n" +
      "  Generate a private secret (e.g. `openssl rand -hex 32`) and set it in the env — a gitignored\n" +
      "  .env in the tenant repo works; it is shared only with the build/auth service that mints tokens.\n" +
      "  (Dev/test uses `reset`, which permits the public dev key — never a real tenant.)",
  );
}

export interface SurrealConfig {
  url: string;
  username: string;
  password: string;
  /** SurrealDB namespace (fixed: merovingian) */
  ns: string;
  /** SurrealDB database = the merovingian tenant (e.g. acme) */
  db: string;
}

/** Connection config for a tenant. Url resolution: overrides (per-invocation) >
 *  env SURREAL_URL (escape hatch) > the machine registry (written from the tenant
 *  repo's merovingian.toml by authoring commands) > the docker-compose default. */
export function surrealConfig(tenant: string, overrides: Partial<SurrealConfig> = {}, home?: string): SurrealConfig {
  const env = process.env;
  return {
    url: env.SURREAL_URL ?? registeredSurrealUrl(tenant, home) ?? "ws://localhost:8020/rpc",
    username: env.SURREAL_USER ?? "root",
    password: env.SURREAL_PASS ?? "root",
    ns: env.SURREAL_NS ?? "merovingian",
    db: env.SURREAL_DB ?? tenant,
    ...overrides,
  };
}

/** Reject if `p` doesn't settle within `ms` (the ws client has no connect timeout). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)),
  ]);
}

/** Connect + signin + use. Caller owns close(). Tries the credential at ROOT scope
 *  first (the dev default), then NAMESPACE, then DATABASE — so a real server can hand
 *  the operator a db-scoped system user (least privilege; a db OWNER can deploy/drain
 *  its own tenant) instead of root. First scope that authenticates wins. */
export async function connectSurreal(cfg: SurrealConfig, timeoutMs = 4000): Promise<Surreal> {
  const db = new Surreal();
  try {
    await withTimeout(db.connect(cfg.url), timeoutMs, `connect ${cfg.url}`);
    const { username, password } = cfg;
    try {
      await db.signin({ username, password });
    } catch {
      try {
        await db.signin({ username, password, namespace: cfg.ns });
      } catch {
        await db.signin({ username, password, namespace: cfg.ns, database: cfg.db });
      }
    }
    await db.use({ namespace: cfg.ns, database: cfg.db });
    return db;
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }
}

/** Password SIGNIN via the identity record access: SurrealDB checks the argon2 hash in
 *  `credential` and ITSELF issues the scoped token (signed with the KEY that never leaves
 *  the database). Returns the token — the same shape the mint/service paths produce. */
export async function signinIdentity(cfg: SurrealConfig, userId: string, pass: string, timeoutMs = 6000): Promise<string> {
  const db = new Surreal();
  try {
    await withTimeout(db.connect(cfg.url), timeoutMs, `connect ${cfg.url}`);
    const ret: unknown = await withTimeout(
      db.signin({ namespace: cfg.ns, database: cfg.db, access: "identity", variables: { user: userId, pass } } as never),
      timeoutMs,
      "signin identity",
    );
    const token = typeof ret === "string" ? ret : (ret as { access?: string })?.access;
    if (!token) throw new Error("signin succeeded but no token in the response");
    return token;
  } finally {
    await db.close().catch(() => {});
  }
}

/** Connect authenticated as `userId` by password (subject to PERMISSIONS, like any token). */
export async function connectAsPassword(cfg: SurrealConfig, userId: string, pass: string, timeoutMs = 6000): Promise<Surreal> {
  return connectWithToken(cfg, await signinIdentity(cfg, userId, pass, timeoutMs), timeoutMs);
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

/**
 * Mint a scoped identity JWT — the build/auth service's job, stubbed here.
 * Claim `id = user:<userId>` → SurrealDB sets $auth to that record. The gh-auth
 * gate (proving you ARE that user) is the deferred HTTP slice; here anyone can
 * mint anyone. The enforcement that follows is fully real.
 */
export function mintIdentityJwt(cfg: SurrealConfig, userId: string, secret = envJwtSecret() ?? DEV_JWT_SECRET): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: "merovingian-build-auth", ns: cfg.ns, db: cfg.db, ac: "identity", id: `user:${userId}`, iat: now, exp: now + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${sig}`;
}

/** Connect authenticated with a ready scoped JWT (record user, subject to PERMISSIONS).
 *  The MCP uses this — it never mints, just uses the token the service handed it. */
export async function connectWithToken(cfg: SurrealConfig, token: string, timeoutMs = 4000): Promise<Surreal> {
  const db = new Surreal();
  try {
    await withTimeout(db.connect(cfg.url), timeoutMs, `connect ${cfg.url}`);
    await db.use({ namespace: cfg.ns, database: cfg.db });
    await db.authenticate(token);
    return db;
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }
}

/** Connect as a scoped identity by minting its JWT (the build/auth service's job, stubbed). */
export async function connectAs(cfg: SurrealConfig, userId: string, timeoutMs = 4000): Promise<Surreal> {
  return connectWithToken(cfg, mintIdentityJwt(cfg, userId), timeoutMs);
}

/** Best-effort liveness check (used to skip Surreal tests when DB is down). */
export async function surrealReachable(cfg: SurrealConfig): Promise<boolean> {
  try {
    const db = await connectSurreal(cfg, 1500);
    await db.close();
    return true;
  } catch {
    return false;
  }
}

/** Record link / id → the bare id string ("purpose:delivery" -> "delivery"). */
function idOf(v: unknown): string {
  if (v == null) return "";
  if (v instanceof RecordId) return String(v.id);
  if (typeof v === "string") return v.includes(":") ? v.split(":").slice(1).join(":") : v;
  if (typeof v === "object" && "id" in (v as Record<string, unknown>)) {
    return String((v as { id: unknown }).id);
  }
  return String(v);
}

interface PurposeRow {
  id: RecordId; reason: string; parent: RecordId | null;
  decides: string[]; owns: unknown[]; reads: unknown[];
  skills: string[]; tools: string[];
  /** authored ref: "name" (library) or "plugin@marketplace" (external) */
  agent: string | null;
}
interface BucketRow {
  id: RecordId; backend: Bucket["backend"]; repo: string | null;
  tables: string[]; owner: RecordId; rowScope: string | null; sens: Bucket["sens"];
}
interface ConfigRow {
  ambient: string[];
}
interface MarketplaceRow { id: RecordId; repo: string }
interface SkillRow {
  id: RecordId; source: "plugin" | "library";
  plugin: string | null; marketplace: RecordId | null;
  files: Record<string, string> | null;
}
interface AgentRow { id: RecordId; content: string }
interface DecisionRow {
  id: RecordId; domain: string; status: DecisionDef["status"]; title: string;
  content: string; supersedes: RecordId | null; at: unknown;
}

export class SurrealProvider implements DefinitionProvider {
  readonly namespace: string;
  constructor(private db: Surreal, namespace: string) {
    this.namespace = namespace;
  }

  async getDefinition(): Promise<Definition> {
    const [cfgRows] = await this.db.query<[ConfigRow[]]>("SELECT * FROM config");
    const [purposeRows] = await this.db.query<[PurposeRow[]]>("SELECT * FROM purpose");
    const [bucketRows] = await this.db.query<[BucketRow[]]>("SELECT * FROM bucket");
    const [toolRows] = await this.db.query<[(ToolDef & { id: RecordId })[]]>("SELECT * FROM tool");
    const [marketplaceRows] = await this.db.query<[MarketplaceRow[]]>("SELECT * FROM marketplace");
    const [skillRows] = await this.db.query<[SkillRow[]]>("SELECT * FROM skill");
    const [agentRows] = await this.db.query<[AgentRow[]]>("SELECT * FROM agent");
    const [decisionRows] = await this.db.query<[DecisionRow[]]>("SELECT * FROM decision");

    const cfg = cfgRows[0];
    if (!cfg) throw new Error(`namespace "${this.namespace}" not migrated (config empty). Run: merovingian deploy apply (from the tenant repo)`);

    const purposes: Purpose[] = purposeRows.map((p) => ({
      id: idOf(p.id),
      parent: p.parent ? idOf(p.parent) : null,
      reason: p.reason,
      decides: p.decides ?? [],
      owns: (p.owns ?? []).map(idOf),
      reads: (p.reads ?? []).map(idOf),
      skills: p.skills ?? [],
      tools: p.tools ?? [],
    }));

    const buckets: Bucket[] = bucketRows.map((b) => ({
      id: idOf(b.id),
      backend: b.backend,
      ...(b.repo ? { repo: b.repo } : {}),
      ...(b.tables?.length ? { tables: b.tables } : {}),
      owner: idOf(b.owner),
      ...(b.rowScope ? { rowScope: b.rowScope } : {}),
      sens: b.sens,
    }));

    const toolCatalog: Record<string, ToolDef> = {};
    for (const t of toolRows) {
      toolCatalog[idOf(t.id)] = {
        kind: t.kind ?? "stdio",
        ...(t.command != null ? { command: t.command } : {}),
        args: t.args ?? [],
        env: t.env ?? {},
        keySource: t.keySource,
        ...(t.url != null ? { url: t.url } : {}),
      };
    }

    const marketplaces: Record<string, string> = {};
    for (const m of marketplaceRows) marketplaces[idOf(m.id)] = m.repo;

    const skillCatalog: Record<string, SkillRef> = {};
    for (const s of skillRows) {
      skillCatalog[idOf(s.id)] =
        s.source === "library"
          ? { source: "library", files: s.files ?? {} }
          : { source: "plugin", plugin: s.plugin ?? "", marketplace: idOf(s.marketplace) };
    }

    const agentContent = new Map<string, string>();
    for (const a of agentRows) agentContent.set(idOf(a.id), a.content);

    const decisionCatalog: Record<string, DecisionDef> = {};
    for (const d of decisionRows) {
      decisionCatalog[idOf(d.id)] = {
        domain: d.domain,
        status: d.status,
        title: d.title,
        content: d.content,
        ...(d.supersedes ? { supersedes: idOf(d.supersedes) } : {}),
        ...(d.at != null ? { at: (d.at instanceof Date ? d.at : new Date(String(d.at))).toISOString() } : {}),
      };
    }

    // "@" is the discriminator the purpose record stores (see records.agentRefString).
    const agentByPurpose: Record<string, AgentRef> = {};
    for (const p of purposeRows) {
      if (!p.agent) continue;
      const at = p.agent.indexOf("@");
      agentByPurpose[idOf(p.id)] =
        at >= 0
          ? { source: "plugin", plugin: p.agent.slice(0, at), marketplace: p.agent.slice(at + 1) }
          : { source: "library", name: p.agent, ...(agentContent.has(p.agent) ? { content: agentContent.get(p.agent)! } : {}) };
    }

    return {
      namespace: this.namespace,
      ambient: { skills: cfg.ambient ?? [] },
      purposes,
      buckets,
      toolCatalog,
      skillCatalog,
      agentByPurpose,
      marketplaces,
      decisionCatalog,
    };
  }

  async resolveUser(userId: string): Promise<User> {
    const [users] = await this.db.query<[{ id: RecordId; name: string; github: string | null }[]]>(
      "SELECT * FROM type::record('user', $id)",
      { id: userId },
    );
    const u = users[0];
    if (!u) throw new Error(`unknown user "${userId}" in namespace "${this.namespace}"`);

    // ALL edges — a human can belong to several purposes (access = union). role
    // defaults to member (matches the schema default for legacy rows).
    const [edges] = await this.db.query<[{ out: RecordId; scope: string | null; role: Role | null }[]]>(
      "SELECT out, scope, role FROM responsible WHERE in = type::record('user', $id)",
      { id: userId },
    );
    if (!edges.length) throw new Error(`user "${userId}" has no assignment (responsible edge) in "${this.namespace}"`);

    return {
      id: idOf(u.id),
      name: u.name,
      ...(u.github ? { github: u.github } : {}),
      assignments: edges.map((e) => ({
        purpose: idOf(e.out),
        ...(e.scope ? { scope: e.scope } : {}),
        role: e.role ?? "member",
      })),
    };
  }

  async listAssignments(): Promise<AssignmentRow[]> {
    // One traversal of the responsible edge: every human→purpose at once, with
    // the linked user's name/github fetched via record-link dot-access.
    const [rows] = await this.db.query<
      [{ uid: string; name: string; github: string | null; purpose: string; scope: string | null; role: Role | null }[]]
    >(
      "SELECT record::id(in) AS uid, in.name AS name, in.github AS github, record::id(out) AS purpose, scope, role FROM responsible",
    );
    return rows.map((r) => ({
      user: { id: r.uid, name: r.name, ...(r.github ? { github: r.github } : {}) },
      purpose: r.purpose,
      ...(r.scope ? { scope: r.scope } : {}),
      role: r.role ?? "member",
    }));
  }
}
