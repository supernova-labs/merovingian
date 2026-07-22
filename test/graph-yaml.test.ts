// Unit tests for the graph YAML loader — contract v2 (ADR 0012). Pure, no DB, no
// filesystem: the tenant library is INJECTED. Asserts: external refs are always
// explicit plugin@marketplace; uncatalogued names resolve from the library by
// convention; the old syntax (defaultMarketplace, bare refs, razao, bucket scope)
// fails loudly (.strict()).

import { expect, test, describe } from "bun:test";
import { parseGraph, type TenantLibrary } from "../src/graph/load-graph.ts";
import { validateGraph } from "../src/graph/plan.ts";

const LIB: TenantLibrary = {
  skills: {
    journal: { "SKILL.md": "# journal\nrecord the session", "format.md": "## format" },
    route: { "SKILL.md": "# route" },
    dormant: { "SKILL.md": "# never referenced" },
  },
  agents: {
    core: "# core agent",
  },
};

const YAML = `
namespace: acme
ambient:
  skills: [journal]
marketplaces:
  guild: acme/guild
tools:
  perplexity:
    command: uvx
    args: [perplexity-mcp]
    env: { PERPLEXITY_API_KEY: "\${PERPLEXITY_API_KEY}" }
    keySource: company
skills:
  audit: compliance@guild
purposes:
  - id: root
    parent: null
    reason: "the shell"
    agent: core
    skills: [journal, route]
  - id: legal
    parent: root
    reason: "contracts"
    agent: counsel@guild
    owns: [contracts]
    skills: [audit]
buckets:
  - { id: contracts, backend: surreal, tables: [contract], owner: legal, rowScope: account, sens: high }
users:
  - id: ana
    name: Ana
    github: ana-gh
    assignments:
      - { purpose: root, role: owner }
      - { purpose: legal, scope: nord }
`;

describe("parseGraph (contract v2)", () => {
  const { definition, users } = parseGraph(YAML, LIB);

  test("catalog entries are external plugin refs; uncatalogued names resolve from the library", () => {
    expect(definition.skillCatalog.audit).toEqual({ source: "plugin", plugin: "compliance", marketplace: "guild" });
    expect(definition.skillCatalog.journal).toEqual({ source: "library", files: LIB.skills.journal! });
    expect(definition.skillCatalog.route).toEqual({ source: "library", files: LIB.skills.route! });
  });

  test("unreferenced library folders are dormant — not folded into the catalog", () => {
    expect(definition.skillCatalog.dormant).toBeUndefined();
  });

  test("agent: '@' discriminates external plugin vs library agent (content attached)", () => {
    expect(definition.agentByPurpose.root).toEqual({ source: "library", name: "core", content: "# core agent" });
    expect(definition.agentByPurpose.legal).toEqual({ source: "plugin", plugin: "counsel", marketplace: "guild" });
  });

  test("a validated graph with library content has zero errors", () => {
    expect(validateGraph(definition, users)).toEqual([]);
  });

  test("purpose carries no `agent` field (lifted out), defaults fill arrays", () => {
    const root = definition.purposes.find((p) => p.id === "root")!;
    expect("agent" in root).toBe(false);
    expect(root.decides).toEqual([]);
    expect(root.tools).toEqual([]);
    expect(root.parent).toBeNull();
  });

  test("bucket optional fields present/absent are preserved", () => {
    const b = definition.buckets[0]!;
    expect(b).toEqual({ id: "contracts", backend: "surreal", tables: ["contract"], owner: "legal", rowScope: "account", sens: "high" });
  });

  test("users keyed by id; assignment role defaults to member", () => {
    expect(Object.keys(users)).toEqual(["ana"]);
    expect(users.ana!.assignments).toEqual([
      { purpose: "root", role: "owner" },
      { purpose: "legal", scope: "nord", role: "member" },
    ]);
  });

  test("tool catalog passes through with ${VAR} refs intact", () => {
    expect(definition.toolCatalog.perplexity).toEqual({
      kind: "stdio",
      command: "uvx",
      args: ["perplexity-mcp"],
      env: { PERPLEXITY_API_KEY: "${PERPLEXITY_API_KEY}" },
      keySource: "company",
    });
  });
});

describe("parseGraph — unresolved refs surface in validateGraph, not the loader", () => {
  test("a referenced skill with no catalog entry and no library folder", () => {
    const { definition, users } = parseGraph(YAML, { skills: {}, agents: LIB.agents });
    const errors = validateGraph(definition, users);
    expect(errors).toContain(`purpose "root": skill "journal" not in catalog and no library/skills/journal/SKILL.md`);
    expect(errors).toContain(`ambient: skill "journal" not in catalog and no library/skills/journal/SKILL.md`);
  });

  test("a library agent with no library/agents/<name>.md", () => {
    const { definition, users } = parseGraph(YAML, { skills: LIB.skills, agents: {} });
    expect(validateGraph(definition, users)).toContain(`agent of "root": no library/agents/core.md`);
  });
});

describe("parseGraph — contract v2 rejects the old syntax loudly", () => {
  test("defaultMarketplace is gone", () => {
    expect(() => parseGraph(`namespace: a\ndefaultMarketplace: x\npurposes: []\n`)).toThrow();
  });

  test("bare catalog refs (no @) are rejected", () => {
    expect(() => parseGraph(`namespace: a\nskills:\n  journal: ambient\npurposes: []\n`)).toThrow(/plugin@marketplace/);
  });

  test("razao and bucket scope are unknown keys", () => {
    expect(() => parseGraph(`namespace: a\npurposes:\n  - { id: r, razao: "x" }\n`)).toThrow();
    expect(() =>
      parseGraph(`namespace: a\npurposes: []\nbuckets:\n  - { id: b, backend: surreal, owner: r, scope: by-client, sens: high }\n`),
    ).toThrow();
  });

  test("marketplaces is optional — a pure-library tenant needs none", () => {
    const { definition } = parseGraph(`namespace: a\npurposes:\n  - { id: r, reason: "root" }\n`);
    expect(definition.marketplaces).toEqual({});
  });

  test("unsafe library file paths are rejected", () => {
    const evil: TenantLibrary = { skills: { x: { "SKILL.md": "s", "../escape.md": "boom" } }, agents: {} };
    expect(() => parseGraph(`namespace: a\npurposes:\n  - { id: r, reason: "root", skills: [x] }\n`, evil)).toThrow(/unsafe file path/);
  });
});

describe("tool kinds — stdio | http | sse (mirror the .mcp.json types)", () => {
  test("a remote tool is url-only; kind defaults to stdio", () => {
    const { definition } = parseGraph(
      `namespace: a\ntools:\n  tracker: { kind: sse, url: "https://mcp.example.dev/sse" }\n  local: { command: uvx, args: [x] }\npurposes:\n  - { id: r, reason: "root" }\n`,
    );
    expect(definition.toolCatalog.tracker).toEqual({ kind: "sse", url: "https://mcp.example.dev/sse", args: [], env: {}, keySource: "none" });
    expect(definition.toolCatalog.local!.kind).toBe("stdio");
  });

  test("stdio requires command; http/sse require url and take nothing else", () => {
    expect(() => parseGraph(`namespace: a\ntools:\n  t: { args: [x] }\npurposes: []\n`)).toThrow(/stdio requires command/);
    expect(() => parseGraph(`namespace: a\ntools:\n  t: { kind: http }\npurposes: []\n`)).toThrow(/http requires url/);
    expect(() => parseGraph(`namespace: a\ntools:\n  t: { kind: sse, url: "https://x", command: uvx }\npurposes: []\n`)).toThrow(/stdio-only/);
  });
});
