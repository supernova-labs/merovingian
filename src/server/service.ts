// The build/auth service — the server-side box that holds the secrets (Surreal
// root creds + the JWT signing key) and authenticates the human via GitHub.
// It reuses the SAME resolve/SurrealProvider as the in-process path; the only
// new thing is the network boundary + gh-auth. The user's machine ends up
// holding neither root creds nor the signing key — just a gh token and the
// short-lived {manifest, token} this returns.

import { connectSurreal, surrealConfig, mintIdentityJwt, SurrealProvider } from "../provider/surreal.ts";
import { LocalBuildService } from "../service/build-service.ts";

/** Resolve a GitHub login from a token (real call). Injectable for tests. */
export async function githubLoginFromToken(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "merovingian", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`github auth failed: ${res.status}`);
  const body = (await res.json()) as { login: string };
  return body.login;
}

export interface ServiceDeps {
  /** maps a gh token → gh login; injected so tests don't hit GitHub */
  resolveGithubLogin: (ghToken: string) => Promise<string>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch handler: GET /whoami and GET /manifest, both gh-authenticated. */
export function makeHandler(deps: ServiceDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/whoami" && url.pathname !== "/manifest" && url.pathname !== "/token") return json(404, { error: "not found" });

    const ghToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!ghToken) return json(401, { error: "missing Authorization: Bearer <gh-token>" });

    let login: string;
    try {
      login = await deps.resolveGithubLogin(ghToken);
    } catch {
      return json(401, { error: "github auth failed" });
    }

    const namespace = url.searchParams.get("namespace") ?? "acme";
    const cfg = surrealConfig(namespace);
    let db;
    try {
      db = await connectSurreal(cfg); // root — server-side only
    } catch {
      return json(502, { error: "surreal unavailable" });
    }
    try {
      const [rows] = await db.query<[{ uid: string; name: string }[]]>(
        "SELECT record::id(id) AS uid, name FROM user WHERE github = $login",
        { login },
      );
      const u = rows[0];
      if (!u) return json(403, { error: `github "${login}" not mapped in "${namespace}"` });

      if (url.pathname === "/whoami") return json(200, { login, user: u.uid, name: u.name, namespace });

      // /token — a fresh scoped Surreal JWT. MCPs fetch this per-call (no stale
      // token sits in any file); expiry stops being a problem.
      if (url.pathname === "/token") return json(200, { token: mintIdentityJwt(cfg, u.uid) });

      const purposes = (url.searchParams.get("purposes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const svc = new LocalBuildService(new SurrealProvider(db, namespace), "<REMOTE>");
      let manifest;
      try {
        manifest = await svc.getManifest(u.uid, purposes.length ? { purposes } : {});
      } catch (e) {
        return json(400, { error: e instanceof Error ? e.message : String(e) });
      }
      const token = mintIdentityJwt(cfg, u.uid);
      return json(200, { manifest, token });
    } finally {
      await db.close();
    }
  };
}

export interface StartOpts {
  port?: number;
  deps?: ServiceDeps;
}

/** Start the HTTP service (Bun.serve). Returns the server (call .stop()). */
export function startService(opts: StartOpts = {}): { port: number; stop: () => void } {
  const handler = makeHandler(opts.deps ?? { resolveGithubLogin: githubLoginFromToken });
  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const server = Bun.serve({ port, fetch: handler });
  return { port: server.port ?? port, stop: () => server.stop(true) };
}
