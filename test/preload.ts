// Test preload (bunfig.toml → [test].preload). Runs once before any test file is
// imported — i.e. before the top-level `reset(...)` bootstraps a throwaway db.
//
// The golden suite provisions and mints against the dev DB (compose :8020). Real
// provisioning now REQUIRES MEROVINGIAN_JWT_SECRET (a real tenant can't be silently
// keyed to the public dev secret). Tests are the sanctioned dev context, so we
// declare the dev key here — the SAME one auth.surql falls back to and mintIdentityJwt
// defaults to — keeping provisioning and minting in sync with zero per-test config.
//
// ??= respects a secret already in the operator's shell (e.g. a real tenant's): the
// throwaway acme dbs just get keyed to it, and mint uses the same value — still consistent.
import { DEV_JWT_SECRET } from "../src/provider/surreal.ts";

process.env.MEROVINGIAN_JWT_SECRET ??= DEV_JWT_SECRET;
