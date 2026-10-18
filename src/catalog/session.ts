import { isIdentityAuthRefusal } from "../provider/auth-error.ts";
import { NotFoundError } from "surrealdb";
import { connectAsPassword, SurrealProvider, type SurrealConfig } from "../provider/surreal.ts";
import { CatalogError, resolveCatalog, type CatalogClient } from "./catalog.ts";

export interface CatalogConfig { cfg: SurrealConfig; user: string; password: string }
/** No root defaults, registry, GitHub precedence, or development mint fallback. */
export function catalogConfig(env: Record<string, string | undefined> = process.env): CatalogConfig {
  for (const key of ["SURREAL_URL", "SURREAL_NS", "MEROVINGIAN_DB", "MEROVINGIAN_USER", "MEROVINGIAN_PASS"]) {
    if (!env[key]) throw new CatalogError("invalid_configuration", `Set ${key} in the personal MCP configuration.`);
  }
  let url: URL;
  try { url = new URL(env.SURREAL_URL!); } catch { throw new CatalogError("invalid_configuration", "SURREAL_URL must be an absolute connection URL."); }
  if (!["ws:", "wss:", "http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CatalogError("invalid_configuration", "Use a connection URL without embedded credentials, query or fragment.");
  }
  return { cfg: { url: url.toString(), ns: env.SURREAL_NS!, db: env.MEROVINGIAN_DB!, username: "", password: "" },
    user: env.MEROVINGIAN_USER!, password: env.MEROVINGIAN_PASS! };
}

export async function readCatalog(config: CatalogConfig, client?: CatalogClient) {
  let db;
  try { db = await connectAsPassword(config.cfg, config.user, config.password); }
  catch (error) {
    if (isIdentityAuthRefusal(error)) {
      throw new CatalogError("invalid_credentials", "Identity connection failed: individual authentication was refused. Verify or rotate the personal credential.");
    }
    if (error instanceof NotFoundError) {
      throw new CatalogError("invalid_configuration", "Identity connection failed: tenant or authentication configuration was not found. Verify the administrator-provided connection details.");
    }
    throw new CatalogError("unavailable", "Identity connection failed. Verify database reachability; no catalog state was inferred.");
  }
  try {
    const [rows] = await db.query<[{ id: string }[]]>("SELECT record::id(id) AS id FROM user WHERE id = $auth");
    if (rows.length !== 1 || rows[0]!.id !== config.user) throw new CatalogError("access_denied", "Authenticated identity is unavailable.");
    const [assignments] = await db.query<[unknown[]]>("SELECT id FROM responsible WHERE in = $auth LIMIT 1");
    if (!assignments.length) throw new CatalogError("access_denied", "No purpose assignments are available for this identity.");
    const provider = new SurrealProvider(db, config.cfg.db);
    const user = await provider.resolveUser(rows[0]!.id);
    return resolveCatalog(await provider.getDefinition(), user, client);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError("unavailable", "Unable to read the authenticated catalog. No empty catalog or access removal was inferred.");
  } finally { await db.close(); }
}
