// Test preload (bunfig.toml → [test].preload). Runs once before any test file is
// imported — i.e. before the top-level `reset(...)` bootstraps a throwaway db.
//
// The golden suite provisions and mints against the dev DB (compose :8020). Real
// provisioning REQUIRES MEROVINGIAN_JWT_SECRET, so we set one here — a stable, private
// TEST secret (deliberately NOT the public DEV_JWT_SECRET, so the real-tenant gate that
// rejects the public key is exercised realistically). Provisioning and minting both read
// this one value, staying in sync with zero per-test config.
//
// `if (!…)` (not `??=`) so an EMPTY string is treated as unset too; and an operator's own
// secret already in the shell still wins (the throwaway acme dbs just get keyed to it).
if (!process.env.MEROVINGIAN_JWT_SECRET) {
  process.env.MEROVINGIAN_JWT_SECRET = "test-suite-signing-secret-not-the-public-dev-key";
}
