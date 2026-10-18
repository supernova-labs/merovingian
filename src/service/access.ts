// Read-only graph resolution. No file emission, secret distribution, or token minting.
import type { DefinitionProvider } from "../provider/types.ts";
import { resolve, type Manifest } from "../projection/resolve.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { SurrealProvider, connectAsPassword, surrealConfig } from "../provider/surreal.ts";
export type Backend = "stub" | "surreal";

export interface AccessService {
  getManifest(userId: string, opts?: { purposes?: string[] }): Promise<Manifest>;
}

export class LocalAccessService implements AccessService {
  constructor(
    private provider: DefinitionProvider,
    private storeRoot?: string,
  ) {}

  async getManifest(userId: string, opts: { purposes?: string[] } = {}): Promise<Manifest> {
    // Whole-graph read + resolve happen HERE, behind the boundary.
    const def = await this.provider.getDefinition();
    const user = await this.provider.resolveUser(userId);
    const manifest = resolve(def, user, { storeRoot: this.storeRoot, purposes: opts.purposes });
    return manifest;
  }
}


export function defaultBackend(flag?: Backend): Backend {
  return flag ?? (process.env.MEROVINGIAN_BACKEND === "stub" ? "stub" : "surreal");
}
export async function accessServiceFor(namespace: string, opts: {backend?: Backend; asUser: string}) {
  if (defaultBackend(opts.backend) === "stub") {
    return {service: new LocalAccessService(stubProviderFor(namespace)), close: async () => {}};
  }
  const password = process.env.MEROVINGIAN_PASS;
  if (!password) throw new Error("MEROVINGIAN_PASS is required for personal graph access");
  const db = await connectAsPassword(surrealConfig(namespace), opts.asUser, password);
  return {service: new LocalAccessService(new SurrealProvider(db, namespace)), close: async () => {await db.close();}};
}
