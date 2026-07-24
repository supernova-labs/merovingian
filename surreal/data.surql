-- ENGINE-ONLY runtime table schema: the learning inbox + decision domain/log.
-- Applied as root (system user — BYPASSES permissions). The identity access that
-- $auth resolves against lives in auth.surql (kept separate so the drain, which
-- re-applies THIS file, never touches the security-critical DEFINE ACCESS). The
-- record identities are SUBORDINATE to the permissions below: this is where the
-- backend actually blocks.
--
-- Domain tables (a tenant's business data) do NOT live here — they are GENERATED
-- from the graph's surreal buckets at apply time (ADR 0011, src/graph/domain.ts).

-- Credentials for password SIGNIN (runtime data, NEVER structural): keyed by the
-- user's plain id (credential:<uid>), NOT a record link — so graph deletes never
-- block on it, and an orphaned credential is inert (SIGNIN returns the user record;
-- user gone → signin fails). Lives HERE (not schema.surql) because apply's full-content
-- replace / reset's wipe must never touch passwords — set via `merovingian passwd`.
-- PERMISSIONS NONE: no record identity ever reads a hash; only the root/system path
-- writes it, and the SIGNIN clause (definition context) compares it server-side.
DEFINE TABLE OVERWRITE credential SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE pass ON credential TYPE string;

-- The learning inbox (ambient): append-only content, scoped resolution (ADR 0014).
-- The authenticated identity appends; `user` is stamped server-side — unforgeable.
-- `scope` routes the friction to the purpose that owns the PROBLEM: members read and
-- resolve within the REAL reach of their lineage (the decision_log mechanism — the
-- self-declared `origin` never authorizes anything). scope = NONE is the root
-- governance queue: invisible to every member, exactly the pre-0014 behavior.
-- Content is immutable post-create (VALUE $before OR $value keeps the first write);
-- only scope / drained / resolved_through actually change. Update permission is
-- checked against the NEW row too: a member re-scopes only within their own reach —
-- escalation beyond it happens at CREATE time (scope any purpose) or via root.
DEFINE TABLE OVERWRITE inbox SCHEMAFULL
  PERMISSIONS
    FOR create WHERE $auth
    FOR select, update WHERE $auth AND scope IS NOT NONE
      AND $auth->responsible->purpose CONTAINSANY scope.lineage
    FOR delete NONE;
-- VALUE re-evaluates on EVERY write: $before OR X = set X on create, keep it after.
DEFINE FIELD OVERWRITE user    ON inbox TYPE record<user> VALUE $before OR $auth;
DEFINE FIELD OVERWRITE kind    ON inbox TYPE "journal" | "friction" VALUE $before OR $value;
DEFINE FIELD OVERWRITE text    ON inbox TYPE string VALUE $before OR $value;
-- Self-reported by the writer (the purpose/agent acting — e.g. "delivery", "shell").
-- Affordance for the drain, NOT identity: `user` is the stamp, origin is telemetry.
DEFINE FIELD OVERWRITE origin  ON inbox TYPE option<string> VALUE $before OR $value;
-- Server-stamped and immutable — even root can't backdate (imports use field surgery).
DEFINE FIELD OVERWRITE at      ON inbox TYPE datetime VALUE $before OR time::now();
-- Whose problem is this? Writer sets it at birth (self / an ancestor / NONE = root's
-- queue); root re-scopes freely (triage, fishing); members re-scope within reach.
DEFINE FIELD OVERWRITE scope   ON inbox TYPE option<record<purpose>>;
-- The trace from problem to solution: PR link, commit, doc, "closed via /encerrar-evento".
DEFINE FIELD OVERWRITE resolved_through ON inbox TYPE option<string>;
-- ONE stamp: "someone saw it and gave it a destination" — root drain or local resolve.
-- Entries are never deleted.
DEFINE FIELD OVERWRITE drained ON inbox TYPE option<datetime>;

-- ─── The decision domain (ADR 0013) ─────────────────────────────────────────
-- Lookup written by apply from purpose.decides (domain → owning purpose). Needed
-- because subquery SCANS inside PERMISSIONS run with the CALLER's permissions
-- (purpose is closed to record users → empty), while record-pointer DOT-ACCESS
-- ignores the target table's permissions — the same mechanism domain.ts relies on
-- (bucket:⟨id⟩.owner.lineage). Reconciled on every apply; a removed domain's row
-- is DELETED (it is live authorization).
DEFINE TABLE OVERWRITE decision_domain SCHEMAFULL;
DEFINE FIELD OVERWRITE owner ON decision_domain TYPE record<purpose>;

-- Ratified decision records (jurisprudence). Authored in the tenant repo's
-- decisions/ and shipped by deploy (root) — never written at runtime. Readable
-- tenant-wide by any authenticated identity. accepted = immutable (supersede).
DEFINE TABLE OVERWRITE decision SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth
    FOR create, update, delete NONE;
DEFINE FIELD OVERWRITE domain     ON decision TYPE string;
DEFINE FIELD OVERWRITE status     ON decision TYPE string ASSERT $value IN ["proposed", "accepted", "superseded"];
DEFINE FIELD OVERWRITE title      ON decision TYPE string;
DEFINE FIELD OVERWRITE content    ON decision TYPE string;
DEFINE FIELD OVERWRITE supersedes ON decision TYPE option<record<decision>>;
DEFINE FIELD OVERWRITE at         ON decision TYPE option<datetime>;
-- reserved for the vector-search slice (never written today)
DEFINE FIELD OVERWRITE embedding  ON decision TYPE option<array<float>>;

-- In-flight decision log: members append via the decisions MCP; visible to whoever
-- reaches the domain's owning purpose (any responsible edge on ancestor-or-self —
-- logs have no rowScope). Un-ratified: workspaces must confirm with a human before
-- applying one (the epistemic posture is prompt-side; THIS is the access gate).
-- create = select ("you log decisions in domains you operate in"): a CREATE's return
-- is filtered by the select permission, so a laxer create would write rows the
-- creator can't read back and [] would be ambiguous. With the clauses equal,
-- [] ALWAYS means blocked-nothing-written (ghost domain or out of reach) — still a
-- SILENT no-op, callers must check the result.
DEFINE TABLE OVERWRITE decision_log SCHEMAFULL
  PERMISSIONS
    FOR create, select WHERE $auth->responsible->purpose CONTAINSANY type::record("decision_domain", domain).owner.lineage
    FOR update, delete NONE;
DEFINE FIELD OVERWRITE user    ON decision_log TYPE record<user> VALUE $before OR $auth;
DEFINE FIELD OVERWRITE domain  ON decision_log TYPE string;
DEFINE FIELD OVERWRITE text    ON decision_log TYPE string;
DEFINE FIELD OVERWRITE records ON decision_log TYPE option<array<record<decision>>>;
DEFINE FIELD OVERWRITE at      ON decision_log TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE drained ON decision_log TYPE option<datetime>;
