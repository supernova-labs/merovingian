-- ENGINE-ONLY auth schema: the JWT identity access. SEPARATE from data.surql so
-- the frequently-run inbox/decision drain (which re-applies data.surql to keep the
-- table schema current) NEVER touches this security-critical statement. Only the
-- provisioning path (deploy apply / reset) applies this file.
--
-- Applied as root (system user — BYPASSES permissions). JWT/record identities are
-- SUBORDINATE to the table PERMISSIONS in data.surql: those are where the backend blocks.

-- Identidade scoped via JWT: o serviço de build/auth (depois do gh-auth) assina um
-- JWT com claim id = user:<x>; o Surreal verifica a assinatura e $auth vira aquele
-- user. TYPE RECORD WITH JWT: aceita um JWT assinado externamente (pelo serviço) e,
-- pelo claim `id`, resolve $auth = aquele user record. (TYPE JWT puro só setaria
-- $token, sem identidade de record.)
--
-- KEY is bound from $jwt_secret (never hardcoded): a real tenant is provisioned with
-- a private secret (MEROVINGIAN_JWT_SECRET, held only by the build/auth service);
-- dev/test provisioning (reset) falls back to the PUBLIC dev key. A dev-key token is
-- rejected by any real tenant by construction — the two keys never match. SurrealDB
-- stores the KEY redacted, so the secret never leaks back through INFO FOR DB.
--
-- SIGNIN (ADR: signin-antes-do-service): the person authenticates with their OWN
-- password — hash in the runtime `credential` table (data.surql), compared server-side
-- with argon2 — and SurrealDB itself issues the scoped token, signed with the KEY that
-- never leaves the database. No machine holds the signing key; each machine holds only
-- its person's password (blast radius = that one identity). Coexists with WITH JWT:
-- externally-signed tokens (dev/test mint, the future build/auth service) keep working.
DEFINE ACCESS OVERWRITE identity ON DATABASE TYPE RECORD
  SIGNIN (
    SELECT * FROM user WHERE record::id(id) = $user
      AND crypto::argon2::compare(type::record("credential", $user).pass, $pass)
  )
  WITH JWT ALGORITHM HS256 KEY $jwt_secret
  DURATION FOR TOKEN 1h, FOR SESSION 1h;
