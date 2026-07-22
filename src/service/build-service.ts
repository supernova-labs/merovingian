// The build/auth service boundary. In production this runs server-side: it
// holds the backend creds, sees the whole graph, runs `resolve`, and returns a
// scoped Manifest (+ a scoped token). The CLI consumes Manifest only.
//
// Three implementations behind one interface:
//   - LocalBuildService(stub)    — fixture in memory (offline, golden tests)
//   - LocalBuildService(surreal) — reads the graph from Surreal in-process
//   - RemoteBuildService         — calls the HTTP service (gh-auth, secrets server-side)
// Same getManifest() → build/graph never change.

import type { DefinitionProvider } from "../provider/types.ts";
import { resolve, resolveToolEnv, type Manifest } from "../projection/resolve.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { SurrealProvider, connectSurreal, surrealConfig, mintIdentityJwt } from "../provider/surreal.ts";
import { repoStore, repoDir } from "../paths.ts";

export type Backend = "stub" | "surreal";

export interface BuildService {
  getManifest(userId: string, opts?: { purposes?: string[] }): Promise<Manifest>;
}

export class LocalBuildService implements BuildService {
  constructor(
    private provider: DefinitionProvider,
    private storeRoot?: string,
  ) {}

  async getManifest(userId: string, opts: { purposes?: string[] } = {}): Promise<Manifest> {
    // Whole-graph read + resolve happen HERE, behind the boundary.
    const def = await this.provider.getDefinition();
    const user = await this.provider.resolveUser(userId);
    const manifest = resolve(def, user, { storeRoot: this.storeRoot, purposes: opts.purposes });
    // resolve company-key refs from THIS env (server-side when the service runs us).
    manifest.toolEnv = resolveToolEnv(manifest.toolMounts, process.env);
    return manifest;
  }
}

/** Talks to the HTTP build/auth service. Identity comes from the gh token, not userId. */
export class RemoteBuildService implements BuildService {
  lastToken?: string;
  constructor(
    private url: string,
    private namespace: string,
    private ghToken: string,
    private storeRoot: string,
  ) {}

  async getManifest(_userId: string, opts: { purposes?: string[] } = {}): Promise<Manifest> {
    const u = new URL(`${this.url}/manifest`);
    u.searchParams.set("namespace", this.namespace);
    if (opts.purposes?.length) u.searchParams.set("purposes", opts.purposes.join(","));
    const res = await fetch(u, { headers: { Authorization: `Bearer ${this.ghToken}` } });
    const body = (await res.json()) as { manifest?: Manifest; token?: string; error?: string };
    if (!res.ok || !body.manifest) throw new Error(`service: ${res.status} ${body.error ?? ""}`);
    this.lastToken = body.token;
    // okf paths are client-side — the service doesn't know our filesystem.
    for (const o of body.manifest.okf) o.path = repoDir(this.storeRoot, o.repo);
    return body.manifest;
  }
}

export interface ServiceHandle {
  service: BuildService;
  /** the scoped Surreal JWT for this identity, if the backend has one (else undefined) */
  identityToken(userId: string): Promise<string | undefined>;
  /** release backend resources (DB connection); noop otherwise */
  close(): Promise<void>;
}

export interface ServiceOpts {
  backend?: Backend;
  storeRoot?: string;
  /** override the SurrealDB database (tests use a throwaway db) */
  surrealDb?: string;
  /** when set, use the remote HTTP service (gh-authenticated) */
  remote?: { url: string; ghToken: string };
}

/** Resolve the env/flag default backend. Surreal is the product default; the stub
 *  (the bundled acme fixture) is explicit opt-in — tests and offline contributors. */
export function defaultBackend(flag?: Backend): Backend {
  if (flag) return flag;
  return process.env.MEROVINGIAN_BACKEND === "stub" ? "stub" : "surreal";
}

/** Build a service for a namespace. Caller must close(). */
export async function buildServiceFor(namespace: string, opts: ServiceOpts = {}): Promise<ServiceHandle> {
  if (opts.remote) {
    const svc = new RemoteBuildService(opts.remote.url, namespace, opts.remote.ghToken, opts.storeRoot ?? repoStore(namespace));
    return { service: svc, identityToken: async () => svc.lastToken, close: async () => {} };
  }

  const backend = defaultBackend(opts.backend);

  if (backend === "surreal") {
    const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
    const db = await connectSurreal(cfg);
    return {
      service: new LocalBuildService(new SurrealProvider(db, namespace), opts.storeRoot),
      identityToken: async (userId) => mintIdentityJwt(cfg, userId),
      close: async () => {
        await db.close();
      },
    };
  }

  return {
    service: new LocalBuildService(stubProviderFor(namespace), opts.storeRoot),
    identityToken: async () => undefined,
    close: async () => {},
  };
}
