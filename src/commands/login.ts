import { connectionDiagnostic } from "./connection-diagnostic.ts";
import { writeJsonAtomic } from "../fs/atomic.ts";
import { sessionFile } from "../paths.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { connectWithToken, signinIdentity, surrealConfig } from "../provider/surreal.ts";
import type { User } from "../provider/types.ts";
import { defaultBackend, type Backend } from "../service/access.ts";

export interface Session {
  namespace: string;
  user: string;
  github?: string;
  loggedInAt: string;
}

export interface LoginOpts {
  backend?: Backend;
  /** password for identity SIGNIN (also read from MEROVINGIAN_PASS) */
  password?: string;
}

export async function login(namespace: string, userId?: string, opts: LoginOpts = {}): Promise<void> {
  if (!userId) throw new Error(`local login needs a user: merovingian login ${namespace} <user>`);
  const backend = defaultBackend(opts.backend);
  let user: Pick<User, "id" | "name">;
  if (backend === "surreal") {
    const cfg = surrealConfig(namespace);
    const pass = opts.password ?? process.env.MEROVINGIAN_PASS;
    if (pass) {
      // password SIGNIN: proves the identity against the argon2 hash AND needs no
      // system credential on this machine — the connection is the scoped user itself.
      // The user table grants the OWN row (id = $auth, ADR 0016), so the person's
      // name reads back; other humans stay invisible.
      const credential = { source: opts.password !== undefined ? "explicit password option" : "MEROVINGIAN_PASS (environment)", password: pass };
      let db;
      try { db = await connectWithToken(cfg, await signinIdentity(cfg, userId, pass)); }
      catch (error) { throw connectionDiagnostic(cfg, error, "personal", "connect", credential); }
      try {
        const [me] = await db.query<[{ uid: string; name?: string }[]]>(
          "SELECT record::id(id) AS uid, name FROM user WHERE id = $auth",
        );
        const row = me[0];
        if (!row?.uid) throw new Error("signin ok but $auth did not resolve — schema drift?");
        user = { id: row.uid, name: row.name ?? row.uid };
      } catch (error) {
        throw connectionDiagnostic(cfg, error, "personal", "read", credential);
      } finally {
        await db.close();
      }
    } else {
      throw new Error("MEROVINGIAN_PASS is required for personal login");
    }
  } else {
    user = await stubProviderFor(namespace).resolveUser(userId);
  }
  await writeJsonAtomic(sessionFile(namespace), {
    namespace,
    user: user.id,
    loggedInAt: new Date().toISOString(),
  } satisfies Session);
  console.log(`logged in as ${user.name} (${user.id}) @ ${namespace} [${backend}]`);
}
