import { expect, test } from "bun:test";
import { parseGraph } from "../src/graph/load-graph.ts";
import { githubDesired } from "../src/github/policy.ts";
import { applyGithub, planGithub, planRepository } from "../src/github/reconcile.ts";
import { inspectRepository, list, type GithubApi, type Snapshot } from "../src/github/api.ts";
import { resolveCatalog } from "../src/catalog/catalog.ts";

const graph = () => parseGraph(`
namespace: acme
purposes:
  - {id: root, reason: Operate}
  - {id: writers, parent: root, reason: Write, owns: [kb]}
  - {id: readers, reason: Read, reads: [kb]}
buckets:
  - {id: kb, backend: okf-repo, repo: acme/kb, owner: writers, sens: low}
users:
  - {id: ada, name: Ada, github: ada-example, assignments: [{purpose: root}]}
  - {id: ben, name: Ben, github: ben-example, assignments: [{purpose: writers}]}
  - {id: cleo, name: Cleo, github: cleo-example, assignments: [{purpose: readers}]}
github:
  repositories:
    acme/kb: {reviewTeam: kb-reviewers}
`);
const snapshot = (): Snapshot => ({ repository: "acme/kb", private: true, archived: false, defaultBranch: "main", admin: true,
  organization: true, basePermission: "none", organizationAdmins: [], collaborators: [], direct: [], invitations: [],
  teams: [{id: 1, slug: "kb-reviewers", permission: "push", members: ["ada-example", "ben-example"]}], rulesets: [] });
const target = () => { const g = graph(); return githubDesired(g.definition,g.users)[0]!; };
const plan = (s: Snapshot, scope: "all" | "permissions" | "protections" = "all") => planRepository(target(),s,graph().users,scope);

test("GitHub entitlement uses subtree union, owns/reads, and ignores assignment role", () => {
  expect(target().access).toEqual({"ada-example":"push","ben-example":"push","cleo-example":"pull"});
  expect(target().reviewers).toEqual(["ada-example","ben-example"]);
  const g = graph();
  g.users.cleo!.assignments.push({purpose:"writers",role:"member"});
  expect(githubDesired(g.definition,g.users)[0]!.access["cleo-example"]).toBe("push");
  expect(JSON.stringify(resolveCatalog(g.definition,g.users.ada!))).not.toContain("reviewTeam");
});

test("missing and duplicate identities block before any external access", () => {
  const g=graph(); delete g.users.ben!.github;
  expect(() => githubDesired(g.definition,g.users)).toThrow("mapping");
  g.users.ben!.github="ADA-EXAMPLE";
  expect(() => githubDesired(g.definition,g.users)).toThrow("Duplicate");
});

test("marketplace consumers get read; ownership comes from the same repository's bucket", () => {
  const g=graph(); g.definition.marketplaces.core={claude:{name:"core",source:"acme/marketplace"}};
  g.definition.skillCatalog.setup={source:"plugin",plugin:"core",marketplace:"core"};
  g.definition.ambient.skills=["setup"];
  g.definition.github!.repositories["acme/marketplace"]={reviewTeam:"core",allowApproverPullRequestBypass:false};
  const desired=githubDesired(g.definition,g.users).find(r=>r.repository==="acme/marketplace")!;
  expect(Object.values(desired.access)).toEqual(["pull","pull","pull"]);
  expect(desired.reviewers).toEqual([]);
  expect(planRepository(desired,{...snapshot(),repository:desired.repository},g.users,"protections").blockers.join()).toContain("no human");
});

test("revokes former members and downgrades excessive direct access", () => {
  const s=snapshot(); s.direct=[{login:"former",type:"User",role_name:"write"},{login:"cleo-example",type:"User",role_name:"admin"}];
  s.collaborators=[...s.direct];
  const p=plan(s,"permissions"); expect(p.blockers).toEqual([]);
  expect(p.changes).toContainEqual(expect.objectContaining({method:"DELETE",path:"/repos/acme/kb/collaborators/former"}));
  expect(p.changes).toContainEqual(expect.objectContaining({method:"PUT",path:"/repos/acme/kb/collaborators/cleo-example",body:{permission:"pull"}}));
});

test("org base, org owners, inherited grants and team excess block rather than claim revocation", () => {
  const s=snapshot(); s.basePermission="read"; s.organizationAdmins=["operator"];
  s.teams[0]!.members.push("former"); s.collaborators=[{login:"inherited",type:"User",role_name:"write"}];
  expect(plan(s,"permissions").blockers.join()).toContain("organization base");
  expect(plan(s,"permissions").blockers.join()).toContain("operator");
  expect(plan(s,"permissions").blockers.join()).toContain("former");
  expect(plan(s,"permissions").blockers.join()).toContain("inherited");
});

test("pending matching invite is not reissued; stale invite is cancelled before replacement", () => {
  const s=snapshot(); s.invitations=[{id:1,invitee:{login:"cleo-example",type:"User"},permissions:"read"}];
  expect(plan(s,"permissions").changes.some(c=>c.path.endsWith("/cleo-example"))).toBe(false);
  s.invitations[0]!.permissions="write";
  const changes=plan(s,"permissions").changes;
  expect(changes.findIndex(c=>c.path.endsWith("/invitations/1"))).toBeLessThan(changes.findIndex(c=>c.path.endsWith("/cleo-example")));
  s.invitations[0]!.invitee=null;
  expect(plan(s,"permissions").blockers.join()).toContain("unmapped invitation");
});

test("review policy checks exact group and defaults to no bypass", () => {
  const s=snapshot(), p=plan(s,"protections"); expect(p.blockers).toEqual([]);
  const body=p.changes[1]!.body as any;
  expect(body.bypass_actors).toEqual([]);
  expect(body.rules[0].parameters.required_reviewers[0].reviewer.id).toBe(1);
  s.teams[0]!.members.push("outsider"); expect(plan(s,"protections").blockers.join()).toContain("exactly");

});

test("mandatory approver is an additional singleton team, not OR with any owner", () => {
  const t=target();t.policy.requiredApprover="ada";t.policy.approverTeam="mandatory";
  const s=snapshot();s.teams.push({id:2,slug:"mandatory",permission:"push",members:["ada-example"]});
  const p=planRepository(t,s,graph().users,"protections");expect(p.blockers).toEqual([]);
  expect((p.changes[1]!.body as any).rules[0].parameters.required_reviewers).toHaveLength(2);
});

test("API defaults and rule order do not create perpetual drift; missing reviewer enforcement does", () => {
  const s=snapshot();const bodies=plan(s,"protections").changes.map(c=>c.body as any); const body=bodies[1]!;
  body.rules[0].parameters.allowed_merge_methods=["merge","squash","rebase"];
  body.rules.reverse(); s.rulesets=bodies.map((b,i)=>({id:7+i,source_type:"Repository",...b}));
  expect(plan(s,"protections").changes).toEqual([]);
  delete (s.rulesets[1]!.rules[0] as any).parameters.required_reviewers;
  expect(plan(s,"protections").changes).toHaveLength(1);
});

class Fake implements GithubApi {
  s=snapshot(); writes: {method:string,path:string,body:unknown}[]=[]; fail=false; ignoreRules=false;
  async request(method: "GET" | "PUT" | "POST" | "DELETE", path:string, body?:unknown): Promise<unknown> {
    if(method!=="GET") {
      this.writes.push({method,path,body}); if(this.fail) throw new Error("SECRET ERROR");
      if(path.includes("/rulesets")) {if(!this.ignoreRules) {
        const b=body as any; const existing=this.s.rulesets.find(r=>r.name===b.name);
        this.s.rulesets=this.s.rulesets.filter(r=>r.name!==b.name);
        this.s.rulesets.push({id:existing?.id ?? 7+this.s.rulesets.length,source_type:"Repository",...b});
      }}
      else if(path.includes("/collaborators/") && method==="PUT") {
        const c={login:path.split("/").at(-1)!,type:"User",role_name:(body as any).permission === "pull" ? "read":"write"};
        this.s.direct.push(c);this.s.collaborators.push(c);
      }
      return null;
    }
    const clean=path.split("?")[0]!;
    if(clean==="/repos/acme/kb")return {private:this.s.private,visibility:"private",archived:false,default_branch:"main",owner:{type:"Organization"},permissions:{admin:true}};
    if(clean==="/orgs/acme")return {default_repository_permission:this.s.basePermission};
    if(clean==="/orgs/acme/members")return [];
    if(clean.endsWith("/collaborators"))return path.includes("affiliation=direct")?this.s.direct:this.s.collaborators;
    if(clean.endsWith("/invitations"))return this.s.invitations;
    if(clean.endsWith("/teams"))return this.s.teams;
    if(clean.endsWith("/members"))return this.s.teams[0]!.members.map(login=>({login,type:"User"}));
    if(clean.endsWith("/rulesets"))return this.s.rulesets;
    if(/\/rulesets\/\d+$/.test(clean))return this.s.rulesets.find(r=>r.id===Number(clean.split("/").at(-1)));
    throw new Error(`Unexpected ${path}`);
  }
}
test("approved apply re-audits, protects before grants, verifies convergence", async()=>{
  const api=new Fake(),g=graph();const p=await planGithub(api,g.definition,g.users);
  expect(api.writes).toEqual([]);
  const report=await applyGithub(api,g.definition,g.users,p.revision);
  expect(report.status).toBe("applied"); expect(api.writes[0]!.path).toContain("rulesets");
});
test("stale approval and blockers cause zero writes", async()=>{
  const api=new Fake(),g=graph();const p=await planGithub(api,g.definition,g.users);
  api.s.archived=true; // Fake metadata intentionally unchanged; change authoritative ACL too.
  api.s.basePermission="read";
  await expect(applyGithub(api,g.definition,g.users,p.revision)).rejects.toThrow("changed");expect(api.writes).toEqual([]);
  const blocked=await planGithub(api,g.definition,g.users);
  await expect(applyGithub(api,g.definition,g.users,blocked.revision)).rejects.toThrow("blocked");expect(api.writes).toEqual([]);
});
test("rejected or silently ignored protection never proceeds to grant access", async()=>{
  for(const ignore of [false,true]) {
    const api=new Fake(),g=graph();api.fail=!ignore;api.ignoreRules=ignore;
    const p=await planGithub(api,g.definition,g.users);const report=await applyGithub(api,g.definition,g.users,p.revision);
    expect(report.status).toBe("partial");expect(api.writes).toHaveLength(1);expect(JSON.stringify(report)).not.toContain("SECRET");
  }
});
test("pagination includes later pages and rejects non-array/error responses",async()=>{
  let calls=0;const api:GithubApi={request:async()=>++calls===1?Array(100).fill({login:"a"}):[{login:"last"}]};
  expect(await list(api,"/items")).toHaveLength(101);expect(calls).toBe(2);
  await expect(list({request:async()=>({message:"forbidden"})},"/items")).rejects.toThrow();
});
test("missing administrative metadata fails closed",async()=>{
  await expect(inspectRepository({request:async()=>({private:true})},"acme/kb")).rejects.toThrow();
});

test("manual approver bypass is PR-only and never bypasses branch integrity", () => {
  const g=graph(); const t=target();
  t.policy={...t.policy,requiredApprover:"ada",approverTeam:"mandatory",allowApproverPullRequestBypass:true};
  const s=snapshot();s.teams.push({id:2,slug:"mandatory",permission:"push",members:["ada-example"]});
  const p=planRepository(t,s,g.users,"protections");
  expect(p.blockers).toEqual([]);
  const [integrity,review]=p.changes.map(c=>c.body as any);
  expect(integrity.name).toBe("merovingian-branch-integrity");
  expect(integrity.bypass_actors).toEqual([]);
  expect(integrity.rules).toEqual([{type:"deletion"},{type:"non_fast_forward"}]);
  expect(review.bypass_actors).toEqual([{actor_id:2,actor_type:"Team",bypass_mode:"pull_request"}]);
  expect(review.rules.map((r:any)=>r.type)).toEqual(["pull_request"]);
  s.teams[1]!.members.push("ben-example");
  expect(planRepository(t,s,g.users,"protections").blockers.join()).toContain("exactly");
});

test("combined ruleset upgrade installs integrity before replacing approval rules", () => {
  const s=snapshot(); const bodies=plan(s,"protections").changes.map(c=>c.body as any);
  const review=bodies[1]!;
  s.rulesets=[{id:12,source_type:"Repository",...review,rules:[...bodies[0]!.rules,...review.rules]}];
  const p=plan(s,"protections");
  expect(p.changes.map(c=>c.method)).toEqual(["POST","PUT"]);
  expect((p.changes[0]!.body as any).name).toBe("merovingian-branch-integrity");
  expect(p.changes[1]!.path).toBe("/repos/acme/kb/rulesets/12");
});

test("approval rules rejection after integrity creation stops all access grants", async () => {
  const api=new Fake(),g=graph();const base=api.request.bind(api);
  api.request=async(method,path,body)=>{
    if(method!=="GET" && (body as any)?.name==="merovingian-reviewed-changes") throw new Error("rejected");
    return base(method,path,body);
  };
  const p=await planGithub(api,g.definition,g.users);
  const report=await applyGithub(api,g.definition,g.users,p.revision);
  expect(report.status).toBe("partial");
  expect(api.writes).toHaveLength(1);
  expect((api.writes[0]!.body as any).name).toBe("merovingian-branch-integrity");
});

test("manual bypass requires an explicitly mapped mandatory approver",()=>{
  const g=graph();g.definition.github!.repositories["acme/kb"]!.allowApproverPullRequestBypass=true;
  expect(()=>githubDesired(g.definition,g.users)).toThrow("requires an approver");
});
