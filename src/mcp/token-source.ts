// Shared by the system MCPs (surreal-data, inbox): how to build the Surreal
// connection from env, and how to get a fresh scoped token per call (from the
// service via gh, or dev-minted locally). No token ever sits in a file.

import { execFileSync } from "node:child_process";
import { mintIdentityJwt, type SurrealConfig } from "../provider/surreal.ts";

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

/** Token source from env: the service (gh → /token), or dev-mint locally. */
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
  if (!user) throw new Error("set MEROVINGIAN_SERVICE_URL (real) or MEROVINGIAN_USER (dev)");
  return async () => mintIdentityJwt(cfg, user);
}
