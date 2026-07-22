// Demo rows for the `acme` EXAMPLE tenant — fixture domain, not engine (ADR 0011).
// Runs as root (system user, bypasses permissions); RUNTIME data, never structure.
// The `client` table itself is provisioned by the domain-schema generator from the
// fixture graph's `clients` bucket.
//
//   bun fixtures/example/seed.ts [db]      (or: bun run seed:acme)

import { RecordId, type Surreal } from "surrealdb";
import { connectSurreal, surrealConfig } from "../../src/provider/surreal.ts";

/** account = the scope key (matches an assignment's scope, e.g. "north"). */
export const DEMO_CLIENTS = [
  { id: "c1", account: "north", name: "North Co" },
  { id: "c2", account: "west", name: "West Co" },
  { id: "c3", account: "east", name: "East Co" },
];

export async function seedInto(db: Surreal): Promise<number> {
  await db.query("DELETE client;");
  for (const c of DEMO_CLIENTS) {
    await db.create<Record<string, unknown>>(new RecordId("client", c.id)).content({ account: c.account, name: c.name });
  }
  return DEMO_CLIENTS.length;
}

/** Seed the acme demo rows into a db (default: the `acme` database). */
export async function seedAcme(surrealDb?: string): Promise<void> {
  const cfg = surrealConfig("acme", surrealDb ? { db: surrealDb } : {});
  const db = await connectSurreal(cfg);
  try {
    const n = await seedInto(db);
    console.log(`seeded ${n} demo clients into acme (${cfg.url} db=${cfg.db}): ${DEMO_CLIENTS.map((c) => c.account).join(", ")}`);
  } finally {
    await db.close();
  }
}

if (import.meta.main) await seedAcme(process.argv[2]);
