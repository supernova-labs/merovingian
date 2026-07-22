// The `acme` example definition — LOADED from graph.yaml (the desired state is data,
// not code). Thin loader kept so the stub provider and tests have a stable in-memory
// import; the source of truth is the sibling graph.yaml.

import { join } from "node:path";
import { loadGraphFile } from "../../src/graph/load-graph.ts";
import type { Definition, User } from "../../src/provider/types.ts";

const { definition, users } = loadGraphFile(join(import.meta.dir, "graph.yaml"));

export const exampleDefinition: Definition = definition;
export const exampleUsers: Record<string, User> = users;
