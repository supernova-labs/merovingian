// The decision_log enforcement (ADR 0013): members append in-flight decisions; who
// READS one is decided by the db — any responsible edge on ancestor-or-self of the
// domain's owning purpose (via the decision_domain lookup, dot-accessed inside the
// PERMISSION — the scan/dot-access asymmetry this suite pins as an upgrade canary).
//
// Needs a live SurrealDB (own throwaway db).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { surrealConfig, surrealReachable, connectSurreal, connectWithToken, mintIdentityJwt } from "../src/provider/surreal.ts";
import { reset } from "../src/commands/reset.ts";
import { reconcileDecisionDomains } from "../src/graph/apply.ts";
import { loadGraphFile } from "../src/graph/load-graph.ts";
import { visibleRows } from "../src/commands/data.ts";
import { listDecisionLog, drainDecisionLog } from "../src/commands/decisions.ts";

const TEST_DB = "acme_decisions";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  const db = await connectSurreal(cfg);
  await db.query("DELETE decision_log"); // reset keeps runtime rows — clean between runs
  await db.close();
}

/** CREATE a log as a member identity. Returns the created rows (empty = blocked). */
async function registerAs(userId: string, domain: string, text: string, extra = ""): Promise<unknown[]> {
  const db = await connectWithToken(cfg, mintIdentityJwt(cfg, userId));
  try {
    const [rows] = await db.query<[unknown[]]>(
      `CREATE decision_log SET domain = $d, text = $t${extra}`,
      { d: domain, t: text },
    );
    return rows;
  } finally {
    await db.close();
  }
}

const logsFor = (u: string) => visibleRows("acme", u, "decision_log", TEST_DB);
const domains = (rows: Record<string, unknown>[]) => rows.map((r) => r.domain as string).sort();

(dbUp ? describe : describe.skip)("decision_log (purpose-scoped jurisprudence-in-flight, ADR 0013)", () => {
  test("members append in domains they reach; the user stamp is server-side", async () => {
    // fixture domains: pricing→sales, editorial→content, scope→delivery
    expect((await registerAs("ada", "pricing", "enterprise floor set at 20k")).length).toBe(1); // acme ∈ sales.lineage
    expect((await registerAs("ben", "editorial", "used informal voice for the dev post")).length).toBe(1);
    expect((await registerAs("cleo", "scope", "extended sprint by 2 days")).length).toBe(1);

    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[{ user: string; domain: string }[]]>(
        `SELECT record::id(user) AS user, domain FROM decision_log ORDER BY domain`,
      );
      expect(rows.map((r) => `${r.domain}:${r.user}`)).toEqual(["editorial:ben", "pricing:ada", "scope:cleo"]);
    } finally {
      await db.close();
    }
  });

  test("create = select: you cannot log into a domain you cannot read (no blind writes)", async () => {
    // cleo (delivery) tries pricing (sales) — blocked AND nothing lands: [] is unambiguous
    expect(await registerAs("cleo", "pricing", "should never land")).toEqual([]);
    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[unknown[]]>(`SELECT * FROM decision_log WHERE domain = "pricing"`);
      expect(rows.length).toBe(1); // only ada's
    } finally {
      await db.close();
    }
  });

  test("visibility rides the domain owner's lineage — the see/not-see matrix", async () => {
    // ada: unscoped @acme (root) → every domain's owner lineage contains acme → sees ALL
    expect(domains(await logsFor("ada"))).toEqual(["editorial", "pricing", "scope"]);
    // ben: member @content → only editorial (content ∈ lineage(content)); pricing/scope invisible
    expect(domains(await logsFor("ben"))).toEqual(["editorial"]);
    // cleo: SCOPED member @delivery — any responsible edge counts for logs (no rowScope here)
    expect(domains(await logsFor("cleo"))).toEqual(["scope"]);
  });

  test("undeclared domain: create is a SILENT no-op — nothing lands", async () => {
    expect(await registerAs("ada", "ghost-domain", "should never land")).toEqual([]);
    const db = await connectSurreal(cfg);
    try {
      const [rows] = await db.query<[unknown[]]>(`SELECT * FROM decision_log WHERE domain = "ghost-domain"`);
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });

  test("members can neither update nor delete — append-only", async () => {
    const db = await connectWithToken(cfg, mintIdentityJwt(cfg, "ada"));
    try {
      await db.query(`UPDATE decision_log SET text = "hacked"`);
      await db.query(`DELETE decision_log`);
    } finally {
      await db.close();
    }
    const root = await connectSurreal(cfg);
    try {
      const [rows] = await root.query<[{ text: string }[]]>("SELECT text FROM decision_log");
      expect(rows.length).toBe(3);
      expect(rows.some((r) => r.text === "hacked")).toBe(false);
    } finally {
      await root.close();
    }
  });

  test("decision records are tenant-wide: ben reads pricing jurisprudence he can't log into", async () => {
    // reset shipped the fixture's decisions/ — records readable by ANY authenticated identity
    const rows = await visibleRows("acme", "ben", "decision", TEST_DB);
    const ids = rows.map((r) => r.id).map(String).sort();
    expect(ids.some((i) => i.includes("pricing/0001-enterprise-floor"))).toBe(true);
    expect(ids.some((i) => i.includes("editorial/0001-voice"))).toBe(true);
  });

  test("a log citing a record BLOCKS its deletion (referrer-check, array field)", async () => {
    const { referrerCheck } = await import("../src/graph/apply.ts");
    // ada logs a pricing decision grounded in the accepted record
    const db = await connectWithToken(cfg, mintIdentityJwt(cfg, "ada"));
    try {
      const [made] = await db.query<[unknown[]]>(
        `CREATE decision_log SET domain = "pricing", text = "applied the floor to the acme-north deal", records = [type::record("decision", $r)]`,
        { r: "pricing/0001-enterprise-floor" },
      );
      expect(made.length).toBe(1);
    } finally {
      await db.close();
    }
    const root = await connectSurreal(cfg);
    try {
      const referrers = await referrerCheck(root, "decision", "pricing/0001-enterprise-floor");
      expect(referrers.length).toBe(1);
      expect(referrers[0]!.startsWith("decision_log:")).toBe(true);
      // the un-cited record has no referrers
      expect(await referrerCheck(root, "decision", "editorial/0001-voice")).toEqual([]);
    } finally {
      await root.close();
    }
  });

  test("the drain surface: list shows domain + applied records; drain stamps; idempotent", async () => {
    const entries = await listDecisionLog("acme", { surrealDb: TEST_DB });
    expect(entries.length).toBe(4); // pricing(ada), editorial(ben), scope(cleo), pricing-with-records(ada)
    const cited = entries.find((e) => e.records.length)!;
    expect(cited.records).toEqual(["pricing/0001-enterprise-floor"]);
    expect(entries.every((e) => e.drained === null)).toBe(true);

    // narrow drain: only the cited one
    expect(await drainDecisionLog("acme", { ids: [cited.id], surrealDb: TEST_DB })).toEqual([cited.id]);
    expect((await listDecisionLog("acme", { surrealDb: TEST_DB })).length).toBe(3);

    // full drain empties; a second drain is a no-op; --all keeps the history
    expect((await drainDecisionLog("acme", { surrealDb: TEST_DB })).length).toBe(3);
    expect(await listDecisionLog("acme", { surrealDb: TEST_DB })).toEqual([]);
    expect(await drainDecisionLog("acme", { surrealDb: TEST_DB })).toEqual([]);
    const all = await listDecisionLog("acme", { all: true, surrealDb: TEST_DB });
    expect(all.length).toBe(4);
    expect(all.every((e) => e.drained instanceof Date)).toBe(true);
  });

  test("the lookup is LIVE authorization: a domain removed from decides: goes dark", async () => {
    const { definition } = loadGraphFile(EXAMPLE_YAML);
    const without = {
      ...definition,
      purposes: definition.purposes.map((p) => (p.id === "content" ? { ...p, decides: [] } : p)),
    };
    const db = await connectSurreal(cfg);
    try {
      await reconcileDecisionDomains(db, without); // editorial's lookup row is DELETED
      expect(domains(await logsFor("ben"))).toEqual([]); // ben lost editorial
      await reconcileDecisionDomains(db, definition); // restore
      expect(domains(await logsFor("ben"))).toEqual(["editorial"]);
    } finally {
      await db.close();
    }
  });
});
