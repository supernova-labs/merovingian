import {describe,test,expect} from "bun:test";
import {parseGraph} from "../src/graph/load-graph.ts";
import {validateGraph} from "../src/graph/plan.ts";

test("plugin-only graph normalizes instructions and resolves client-specific marketplace bindings",()=>{
 const {definition,users}=parseGraph(`namespace: acme
ambient: {skills: [journal], instructions: "  Shared instructions  "}
marketplaces:
  core: {claude: org/claude, codex: {source: org/codex, name: native}}
skills: {journal: journal@core}
purposes: [{id: acme, reason: Coordinate, agent: core@core}]
users: [{id: ada, name: Ada, github: ada-gh, email: ada@example.org, slackId: U123, journalAdmin: true, assignments: [{purpose: acme, role: owner}]}]
`);
 expect(validateGraph(definition,users)).toEqual([]);
 expect(definition.ambient.instructions).toBe("Shared instructions");
 expect(definition.agentByPurpose.acme).toEqual({source:"plugin",plugin:"core",marketplace:"core"});
 expect(definition.marketplaces.core?.codex).toEqual({source:"org/codex",name:"native"});
 expect(users.ada).toMatchObject({github:"ada-gh",email:"ada@example.org",slackId:"U123",journalAdmin:true});
});
test("legacy authoring syntax cannot silently enable local capabilities",()=>{
 for(const text of [
  'namespace: acme\nagents: {}\npurposes: []',
  'namespace: acme\nskills: {journal: local}\npurposes: []',
  'namespace: acme\npurposes: [{id: acme, reason: Root, agent: local}]',
  'namespace: acme\ndefaultMarketplace: core\npurposes: []',
 ]) expect(()=>parseGraph(text)).toThrow();
 const {definition,users}=parseGraph('namespace: acme\nambient: {skills: [missing]}\npurposes: [{id: acme, reason: Root}]');
 expect(validateGraph(definition,users).length).toBeGreaterThan(0);
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
