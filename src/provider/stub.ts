// StubProvider — the Phase 0 definition provider. Keyed by namespace; the `acme`
// example tenant exists today. Implements the same interface a SurrealProvider
// will, so the projection + golden tests are source-agnostic.

import type { DefinitionProvider, Definition, User, AssignmentRow } from "./types.ts";
import { exampleDefinition, exampleUsers } from "../../fixtures/example/graph.ts";

const REGISTRY: Record<string, { definition: Definition; users: Record<string, User> }> = {
  acme: { definition: exampleDefinition, users: exampleUsers },
};

export class StubProvider implements DefinitionProvider {
  readonly namespace: string;
  private readonly users: Record<string, User>;
  private readonly definition: Definition;

  constructor(namespace: string) {
    const entry = REGISTRY[namespace];
    if (!entry) {
      const known = Object.keys(REGISTRY).join(", ");
      throw new Error(`unknown namespace "${namespace}" (known: ${known})`);
    }
    this.namespace = namespace;
    this.definition = entry.definition;
    this.users = entry.users;
  }

  async getDefinition(): Promise<Definition> {
    return this.definition;
  }

  async resolveUser(userId: string): Promise<User> {
    const user = this.users[userId];
    if (!user) {
      const known = Object.keys(this.users).join(", ");
      throw new Error(`unknown user "${userId}" in namespace "${this.namespace}" (known: ${known})`);
    }
    return user;
  }

  async listAssignments(): Promise<AssignmentRow[]> {
    return Object.values(this.users).flatMap((u) =>
      u.assignments.map((a) => ({
        user: { id: u.id, name: u.name, ...(u.github ? { github: u.github } : {}) },
        purpose: a.purpose,
        ...(a.scope ? { scope: a.scope } : {}),
        role: a.role,
      })),
    );
  }
}

/** Factory — the one place that picks the stub provider for a namespace. */
export function stubProviderFor(namespace: string): DefinitionProvider {
  return new StubProvider(namespace);
}
