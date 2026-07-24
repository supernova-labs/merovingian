// `merovingian passwd <namespace> <user>` — set (or rotate) a person's password for
// the identity SIGNIN. Root/operator surface: connects with the system credential
// (connectSurreal), verifies the user exists in the graph, and upserts the argon2
// hash into the runtime `credential` table (data.surql — apply/reset never touch it).
//
// The password comes from MEROVINGIAN_NEW_PASS or is read from stdin (piped or typed).
// It is hashed server-side (crypto::argon2::generate) and never stored in plain text.

import { connectSurreal, surrealConfig } from "../provider/surreal.ts";
import { ensureDataSchema } from "../graph/apply.ts";

async function readPassword(): Promise<string> {
  const env = process.env.MEROVINGIAN_NEW_PASS;
  if (env) return env;
  if (process.stdin.isTTY) console.error("new password (input is visible — prefer piping or MEROVINGIAN_NEW_PASS):");
  for await (const line of console) return line.trim();
  throw new Error("no password provided (stdin closed; set MEROVINGIAN_NEW_PASS or pipe it)");
}

export interface PasswdOpts {
  surrealDb?: string;
  /** injected by tests to avoid stdin */
  password?: string;
}

export async function passwd(namespace: string, userId: string, opts: PasswdOpts = {}): Promise<void> {
  const pass = opts.password ?? (await readPassword());
  if (pass.length < 8) throw new Error("password too short (minimum 8 characters)");

  const cfg = surrealConfig(namespace, opts.surrealDb ? { db: opts.surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    // an older tenant db may predate the credential table — the runtime schema is
    // idempotent and never carries the signing key, so ensuring it here is safe.
    await ensureDataSchema(db);
    const [rows] = await db.query<[{ uid: string }[]]>(
      "SELECT record::id(id) AS uid FROM user WHERE record::id(id) = $u",
      { u: userId },
    );
    if (!rows[0]) throw new Error(`user "${userId}" not found in "${namespace}" — check the graph (deploy apply ships users)`);
    await db.query(
      "UPSERT type::record('credential', $u) SET pass = crypto::argon2::generate($p)",
      { u: userId, p: pass },
    );
  } finally {
    await db.close();
  }
  console.log(`password set for ${userId} @ ${namespace} (argon2, stored in credential:${userId})`);
}
