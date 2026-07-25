// ADR 0016 — "o grafo também é dado": the structural tables are SELECT-scoped by
// lineage, so build/graph run AS the person (password connection) and the database
// hands the provider exactly their slice. The killer assertion is PARITY: the manifest
// resolved over the person's own scoped connection must be IDENTICAL to the one the
// root provider computes — resolve() degrades SILENTLY on missing catalog entries
// (resolve.ts), so byte-equality is what catches a permission regression.
//
// Needs a live SurrealDB (own throwaway db, isolated from the golden suite).

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import {
  surrealConfig,
  surrealReachable,
  connectSurreal,
  connectAsPassword,
  SurrealProvider,
} from "../src/provider/surreal.ts";
import { LocalBuildService } from "../src/service/build-service.ts";
import { reset } from "../src/commands/reset.ts";
import { passwd } from "../src/commands/passwd.ts";
import { loadGraphFile } from "../src/graph/load-graph.ts";
import { readCurrentState, applyGraph } from "../src/graph/apply.ts";
import { desiredState, planGraph, planIsEmpty } from "../src/graph/plan.ts";

const TEST_DB = "acme_lineage";
const EXAMPLE_YAML = join(import.meta.dir, "../fixtures/example/graph.yaml");
const cfg = surrealConfig("acme", { db: TEST_DB });

const dbUp = await surrealReachable(cfg);
if (dbUp) {
  await reset({ graph: EXAMPLE_YAML, surrealDb: TEST_DB });
  await passwd("acme", "cleo", { surrealDb: TEST_DB, password: "cleo-password-1" });
  await passwd("acme", "ada", { surrealDb: TEST_DB, password: "ada-password-1" });
} else {
  console.log(`[lineage-read] SurrealDB unavailable at ${cfg.url} — skipping. (bun run db:up)`);
}

/** Manifest over an arbitrary connection (root = ground truth; person = experiment). */
async function manifestVia(db: Awaited<ReturnType<typeof connectSurreal>>, userId: string) {
  return new LocalBuildService(new SurrealProvider(db, "acme")).getManifest(userId, {});
}

(dbUp ? describe : describe.skip)("structural reads by lineage (ADR 0016)", () => {
  test("PARITY — cleo (scoped member): manifest over her own connection == root's", async () => {
    const root = await connectSurreal(cfg);
    const own = await connectAsPassword(cfg, "cleo", "cleo-password-1");
    try {
      const truth = await manifestVia(root, "cleo");
      const mine = await manifestVia(own, "cleo");
      expect(JSON.stringify(mine)).toBe(JSON.stringify(truth));
    } finally {
      await root.close();
      await own.close();
    }
  });

  test("PARITY — ada (root owner): the whole tree resolves over her own connection", async () => {
    const root = await connectSurreal(cfg);
    const own = await connectAsPassword(cfg, "ada", "ada-password-1");
    try {
      const truth = await manifestVia(root, "ada");
      const mine = await manifestVia(own, "ada");
      expect(JSON.stringify(mine)).toBe(JSON.stringify(truth));
      // sanity that this parity is not vacuous: ada's entitlement spans the tree
      expect((truth as { visiblePurposes: string[] }).visiblePurposes.length).toBeGreaterThan(5);
    } finally {
      await root.close();
      await own.close();
    }
  });

  test("LEAKS — cleo sees exactly her slice, nothing else", async () => {
    const db = await connectAsPassword(cfg, "cleo", "cleo-password-1");
    try {
      const ids = async (q: string) => {
        const [rows] = await db.query<[{ id: string }[]]>(q);
        return rows.map((r) => r.id).sort();
      };
      // purposes: delivery's subtree only (no ancestors, no siblings)
      expect(await ids("SELECT record::id(id) AS id FROM purpose")).toEqual(["delivery"]);
      // buckets: owns ∪ reads of her purposes — clients is visible METADATA here;
      // its ROWS stay scoped to account:north by the domain PERMISSIONS (ADR 0011)
      expect(await ids("SELECT record::id(id) AS id FROM bucket")).toEqual(["clients", "kb-method", "kb-projects"]);
      // catalogs, strict: only what delivery references...
      expect(await ids("SELECT record::id(id) AS id FROM tool")).toEqual(["tracker"]);
      expect(await ids("SELECT record::id(id) AS id FROM agent")).toEqual(["delivery"]);
      // ...plus the ambient skills (every workspace carries them)
      expect(await ids("SELECT record::id(id) AS id FROM skill")).toEqual(["friction", "journal", "pending"]);
      // no plugin in her slice → no marketplace row
      expect(await ids("SELECT record::id(id) AS id FROM marketplace")).toEqual([]);
      // decision domains: only the ones owned within reach (delivery decides: scope)
      expect(await ids("SELECT record::id(id) AS id FROM decision_domain")).toEqual(["scope"]);
      // humans: only herself; hashes: none
      expect(await ids("SELECT record::id(id) AS id FROM user")).toEqual(["cleo"]);
      const [creds] = await db.query<[unknown[]]>("SELECT * FROM credential");
      expect(creds).toEqual([]);
      // her own edges only
      const [edges] = await db.query<[{ purpose: string }[]]>("SELECT record::id(out) AS purpose FROM responsible");
      expect(edges.map((e) => e.purpose)).toEqual(["delivery"]);
    } finally {
      await db.close();
    }
  });

  test("migration: a legacy db (empty readers) is backfilled BEFORE the confirm gate", async () => {
    // Simulate pre-0016 rows: readers emptied → the lineage permissions fail-closed and
    // members see NOTHING. A converge must repair this even when it STOPS at
    // needs-confirm (the gate returns before any upsert) — the backfill runs first.
    const root = await connectSurreal(cfg);
    try {
      await root.query("UPDATE bucket SET readers = []; UPDATE tool SET readers = []; UPDATE skill SET readers = [], ambient = false; UPDATE agent SET readers = [];");
      const blind = await connectAsPassword(cfg, "cleo", "cleo-password-1");
      try {
        const [b] = await blind.query<[unknown[]]>("SELECT * FROM bucket");
        expect(b).toEqual([]); // fail-closed, as designed
      } finally {
        await blind.close();
      }
      // a desired graph that REMOVES a bucket → plan.delete non-empty → needs-confirm
      const { definition, users } = loadGraphFile(EXAMPLE_YAML);
      const pruned = {
        ...definition,
        buckets: definition.buckets.filter((b) => b.id !== "proposals"),
        purposes: definition.purposes.map((p) => ({
          ...p,
          owns: p.owns.filter((x) => x !== "proposals"),
          reads: p.reads.filter((x) => x !== "proposals"),
        })),
      };
      const report = await applyGraph(root, pruned, users, { reset: false });
      expect(report.status).toBe("needs-confirm"); // no upsert ran...
      const healed = await connectAsPassword(cfg, "cleo", "cleo-password-1");
      try {
        const [ids] = await healed.query<[{ id: string }[]]>("SELECT record::id(id) AS id FROM bucket");
        expect(ids.map((r) => r.id).sort()).toEqual(["clients", "kb-method", "kb-projects"]); // ...but the backfill did
        const [skills] = await healed.query<[{ id: string }[]]>("SELECT record::id(id) AS id FROM skill");
        expect(skills.map((r) => r.id).sort()).toEqual(["friction", "journal", "pending"]); // ambient restored too
      } finally {
        await healed.close();
      }
    } finally {
      await root.close();
    }
  });

  test("no phantom drift: a converge right after reset plans ZERO changes (readers are write-only derived)", async () => {
    const { definition, users } = loadGraphFile(EXAMPLE_YAML);
    const db = await connectSurreal(cfg);
    try {
      const current = await readCurrentState(db, definition.namespace);
      const plan = planGraph(desiredState(definition, users), current);
      expect(planIsEmpty(plan)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
