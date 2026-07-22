// `merovingian login <namespace> [user] [--backend stub|surreal]`
//
// Local (stub/surreal): the <user> arg is the stand-in for the auth result,
// resolved against the graph — the stub fixture or the live surreal db, same
// backend selection as build (--backend / MEROVINGIAN_BACKEND, default stub).
// Remote: no <user> — the identity comes from GitHub. We grab the gh token, ask
// the service who we are (/whoami), and store the resolved identity.

import { writeJsonAtomic } from "../fs/atomic.ts";
import { sessionFile } from "../paths.ts";
import { stubProviderFor } from "../provider/stub.ts";
import { SurrealProvider, connectSurreal, surrealConfig } from "../provider/surreal.ts";
import type { User } from "../provider/types.ts";
import { defaultBackend, type Backend } from "../service/build-service.ts";
import { readNamespace, ghToken } from "../transport.ts";

export interface Session {
  namespace: string;
  user: string;
  github?: string;
  loggedInAt: string;
}

export interface LoginOpts {
  backend?: Backend;
}

export async function login(namespace: string, userId?: string, opts: LoginOpts = {}): Promise<void> {
  // only a REMOTE entry routes login over HTTP — a surreal entry is a local
  // per-tenant server (surrealConfig picks its url up on the local path below).
  const cfg = await readNamespace(namespace);
  const remote = cfg?.transport === "remote" ? cfg : null;

  if (remote) {
    const token = ghToken();
    const res = await fetch(`${remote.url}/whoami?namespace=${encodeURIComponent(namespace)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { user?: string; login?: string; name?: string; error?: string };
    if (!res.ok || !body.user) throw new Error(`login failed: ${body.error ?? res.status}`);

    await writeJsonAtomic(sessionFile(namespace), {
      namespace,
      user: body.user,
      github: body.login,
      loggedInAt: new Date().toISOString(),
    } satisfies Session);
    console.log(`logged in as ${body.name} (${body.user}) via github ${body.login} @ ${namespace}`);
    return;
  }

  // local path — resolve the user in the graph. Backend selection mirrors build:
  // stub validates against the fixture; surreal against the live migrated db
  // (a real local tenant has no fixture — the stub only knows the examples).
  if (!userId) throw new Error(`local login needs a user: merovingian login ${namespace} <user>`);
  const backend = defaultBackend(opts.backend);
  let user: User;
  if (backend === "surreal") {
    const db = await connectSurreal(surrealConfig(namespace));
    try {
      user = await new SurrealProvider(db, namespace).resolveUser(userId);
    } finally {
      await db.close();
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
