#!/usr/bin/env bun
// The build/auth service. Holds Surreal root creds (SURREAL_*) + the JWT signing
// key (MEROVINGIAN_JWT_SECRET) server-side. Authenticates via the real GitHub API.
import { startService } from "../src/server/service.ts";

const { port } = startService();
console.error(`merovingian build/auth service at http://localhost:${port}  (real gh-auth)`);
