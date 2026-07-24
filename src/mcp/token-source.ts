// Shared by the system MCPs (surreal-data, inbox): how to build the Surreal
// connection from env, and how to get a fresh scoped token per call (from the
// service via gh, or dev-minted locally). No token ever sits in a file.

import { execFileSync } from "node:child_process";
import { mintIdentityJwt, signinIdentity, type SurrealConfig } from "../provider/surreal.ts";

export function cfgFromEnv(): SurrealConfig {
  const db = process.env.MEROVINGIAN_DB;
  if (!db) throw new Error("missing MEROVINGIAN_DB in env");
  return {
    url: process.env.SURREAL_URL ?? "ws://localhost:8020/rpc",
    username: "",
    password: "",
    ns: process.env.SURREAL_NS ?? "merovingian",
    db,
  };
}

/** Token source from env, in trust order:
 *   1. MEROVINGIAN_SERVICE_URL — the build/auth service (gh → /token);
 *   2. MEROVINGIAN_PASS — password SIGNIN as MEROVINGIAN_USER (SurrealDB checks the
 *      hash and issues the token itself; the signing key never leaves the database);
 *   3. dev-mint as MEROVINGIAN_USER (needs MEROVINGIAN_JWT_SECRET / the dev key —
 *      only a dev/test db trusts what this signs). */
export function envTokenSource(cfg: SurrealConfig): () => Promise<string> {
  const svc = process.env.MEROVINGIAN_SERVICE_URL;
  const namespace = process.env.MEROVINGIAN_NAMESPACE ?? cfg.db;
  if (svc) {
    return async () => {
      const gh = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
      const res = await fetch(`${svc}/token?namespace=${encodeURIComponent(namespace)}`, { headers: { Authorization: `Bearer ${gh}` } });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(`/token: ${res.status} ${body.error ?? ""}`);
      return body.token;
    };
  }
  const user = process.env.MEROVINGIAN_USER;
  if (!user) throw new Error("set MEROVINGIAN_SERVICE_URL (real), or MEROVINGIAN_USER + MEROVINGIAN_PASS (password signin), or MEROVINGIAN_USER (dev-mint)");
  const pass = process.env.MEROVINGIAN_PASS;
  if (pass) return async () => signinIdentity(cfg, user, pass);
  return async () => mintIdentityJwt(cfg, user);
}
