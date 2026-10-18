-- ENGINE-ONLY runtime table schema: individual credentials and immutable journal.
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

-- New major's journal: personal history; explicit administrators can read all.
-- No product identity (including journalAdmin) can update or delete entries.
-- Administrative root still bypasses permissions, as with every Surreal table.
DEFINE TABLE OVERWRITE journal SCHEMAFULL
  PERMISSIONS
    FOR create WHERE $auth
    FOR select WHERE $auth AND (author = $auth OR $auth.journalAdmin = true)
    FOR update, delete NONE;
DEFINE FIELD OVERWRITE author ON journal TYPE record<user> VALUE $before OR $auth;
DEFINE FIELD OVERWRITE text ON journal TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD OVERWRITE origin ON journal TYPE option<string>;
-- References never grant access; the MCP validates target existence/visibility.
DEFINE FIELD OVERWRITE previous ON journal TYPE option<record<journal>>;
DEFINE FIELD OVERWRITE at ON journal TYPE datetime VALUE $before OR time::now();
