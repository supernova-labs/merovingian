#!/usr/bin/env bun
import { main } from "../src/cli.ts";

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
