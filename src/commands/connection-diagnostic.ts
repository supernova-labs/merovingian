import { isIdentityAuthRefusal } from "../provider/auth-error.ts";
import { NotFoundError } from "surrealdb";
import type { SurrealConfig } from "../provider/surreal.ts";

/** Deliberately never include the driver error/cause: it can contain URLs or secrets. */
export function connectionDiagnostic(
  cfg: SurrealConfig,
  error: unknown,
  mode: "personal" | "operator",
  stage: "connect" | "read" | "write",
  personal?: { source: string; password: string },
  outcome?: "user_missing" | "identity_missing",
): Error {
  const secrets = [cfg.password, personal?.password].filter((s): s is string => !!s);
  const safe = (value: string) => {
    for (const secret of secrets) value = value.split(secret).join("[redacted]");
    return JSON.stringify(value);
  };
  let endpoint = "invalid URL (value omitted)";
  try {
    const url = new URL(cfg.url);
    // Even a path may contain a credential. Only expose protocol, host and port.
    if (["ws:", "wss:", "http:", "https:"].includes(url.protocol)) endpoint = url.origin;
  } catch { /* omit malformed URLs */ }
  const refused = stage === "connect" && isIdentityAuthRefusal(error);
  const reason = outcome === "user_missing" ? "user not found — check the graph (deploy apply ships users)"
    : outcome === "identity_missing" ? "SIGNIN succeeded but the identity record did not resolve — check schema drift"
    : refused ? "Authentication was refused" : error instanceof NotFoundError
    ? "Tenant or schema resource was not found" : stage === "connect"
    ? "Connection or authentication failed" : "Database operation failed";
  const from = (key: "url" | "ns" | "db" | "username" | "password") => cfg.sources?.[key] ?? "provided configuration";
  const credentials = mode === "operator"
    ? `System signin order: root → namespace → database. Credentials: username from ${from("username")}; password from ${from("password")}. Check SURREAL_USER/SURREAL_PASS in the current process; local defaults are for development only.`
    : `Personal identity SIGNIN. Password from ${personal?.source ?? "provided configuration"}. Check MEROVINGIAN_PASS and the administrator-provided tenant details; system credentials do not replace a personal password.`;
  return new Error(`${reason} (${stage}).\n` +
    `Target: ${safe(endpoint)} [${from("url")}]; namespace ${safe(cfg.ns)} [${from("ns")}]; database ${safe(cfg.db)} [${from("db")}].\n` +
    (stage === "connect" ? credentials + "\nCheck the selected target and network reachability."
      : `Authentication succeeded. Check the selected target, schema and permissions for the ${stage} operation.`) +
    "\nEnvironment includes any values loaded by the runtime from .env; file provenance is not available.");
}
