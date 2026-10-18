// Shared by the system MCPs (surreal-data, inbox): how to build the Surreal
// connection from env, and how to get a fresh scoped token per call (from the
// service via gh, or dev-minted locally). No token ever sits in a file.

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

/** Password SIGNIN, with the existing explicit operator/test mint path for data tools.
 * Catalog and Journal use their own strictly personal session contract. */
export function tokenSourceFor(cfg: SurrealConfig, userId: string | undefined): () => Promise<string> {
  if (process.env.MEROVINGIAN_SERVICE_URL) throw new Error("Remote build service authentication is retired; configure individual credentials");
  if (!userId) throw new Error("MEROVINGIAN_USER is required");
  const pass = process.env.MEROVINGIAN_PASS;
  if (pass) return async () => signinIdentity(cfg, userId, pass);
  return async () => mintIdentityJwt(cfg, userId);
}

/** The MCP entrypoint: same order, user from env. */
export function envTokenSource(cfg: SurrealConfig): () => Promise<string> {
  return tokenSourceFor(cfg, process.env.MEROVINGIAN_USER);
}
