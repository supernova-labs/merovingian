#!/usr/bin/env bun
// The Architect's console — local, read-only, NO-AUTH god-view of the tenant
// graph. Binds to 127.0.0.1 only. Default backend: surreal (the real migrated
// graph); MEROVINGIAN_BACKEND=stub serves the fixture offline.
import { startConsole } from "../src/server/console.ts";

const backend = process.env.MEROVINGIAN_BACKEND === "stub" ? "stub" : "surreal";
const { port, namespace, backend: be } = startConsole({ backend });
console.error(`architect console at http://127.0.0.1:${port}  (${namespace} · ${be} · read-only · no auth)`);
