import { expect, test } from "bun:test";
import { parseGraph } from "../src/graph/load-graph.ts";
import { planGithub, applyGithub } from "../src/github/reconcile.ts";
import { requireTeamInventoryScopes, type GithubApi, type Rule } from "../src/github/api.ts";

function graph() {
  return parseGraph(`
namespace: acme
purposes:
  - {id: writers, reason: Write, owns: [kb, kb2]}
  - {id: readers, reason: Read, reads: [kb, kb2]}
buckets:
  - {id: kb, backend: okf-repo, repo: acme/kb, owner: writers, sens: low}
  - {id: kb2, backend: okf-repo, repo: acme/kb2, owner: writers, sens: low}
users:
  - {id: ada, name: Ada, github: ada, assignments: [{purpose: writers}]}
  - {id: ben, name: Ben, github: ben, assignments: [{purpose: writers}]}
  - {id: cleo, name: Cleo, github: cleo, assignments: [{purpose: readers}]}
github:
  managedTeams: [acme/reviewers]
  repositories:
    acme/kb: {reviewTeam: reviewers}
`);
}
interface Team { id:number; slug:string; parent:{id:number}|null; children:{id:number}[]; members:string[]; grants:Record<string,string>; invitations:{id:number;login:string|null}[] }
class Api implements GithubApi {
  async assertTeamInventoryAccess() {}
  teams:Team[]=[{id:1,slug:"reviewers",parent:null,children:[],members:["ada"],grants:{"acme/kb":"push"},invitations:[]}];
  rules:Record<string,Rule[]>={"acme/kb":[],"acme/kb2":[]};
  direct:Record<string,Record<string,string>>={"acme/kb":{},"acme/kb2":{}};
  orgMembers=["ada","ben","cleo","former"];
  orgInvitations:{id:number;login:string|null}[]=[];
  authority="admin";
  writes:{method:string;path:string;body:unknown}[]=[];
  ignorePath=""; failPath=""; unknownActor=false;
  async request(method:"GET"|"PUT"|"POST"|"DELETE",path:string,body?:unknown):Promise<unknown> {
    const clean=path.split("?")[0]!;
    const parts=clean.split("/");
    const team=this.teams.find(t=>t.slug===parts[4]);
    const repo=parts[1]==="repos"?`${parts[2]}/${parts[3]}`:"";
    const b=body as any;
    if(method!=="GET") {
      this.writes.push({method,path,body});
      if(path.includes(this.failPath) && this.failPath) throw new Error("private failure");
      if(path.includes(this.ignorePath) && this.ignorePath) return null;
      if(team && parts[5]==="memberships") {
        team.members=team.members.filter(m=>m!==parts[6]); if(method==="PUT")team.members.push(parts[6]!);
      } else if(team && parts[5]==="repos") team.grants[`${parts[6]}/${parts[7]}`]=b.permission;
      else if(parts[4]==="rulesets") {
        const rules=this.rules[repo]!;const old=rules.find(r=>r.name===b.name);
        this.rules[repo]=[...rules.filter(r=>r.name!==b.name),{id:old?.id??100+rules.length,source_type:"Repository",...b}];
      } else if(parts[4]==="collaborators") {
        if(method==="DELETE")delete this.direct[repo]![parts[5]!];else this.direct[repo]![parts[5]!]=b.permission;
      } else throw new Error(`Unexpected mutation ${path}`);
      return null;
    }
    if(clean==="/user/memberships/orgs/acme")return {state:"active",role:this.authority};
    if(clean==="/orgs/acme")return {default_repository_permission:"none"};
    if(clean==="/orgs/acme/members")return path.includes("role=admin")?[]:this.orgMembers.map(login=>({login,type:"User"}));
    if(clean==="/orgs/acme/invitations")return this.orgInvitations;
    if(parts[1]==="orgs" && parts[3]==="teams") {
      if(!team)throw new Error("missing");
      if(parts.length===5)return team;
      if(parts[5]==="teams")return team.children;
      if(parts[5]==="repos")return Object.keys(team.grants).map(full_name=>({full_name}));
      if(parts[5]==="members")return team.members.map(login=>({login,type:"User"}));
      if(parts[5]==="memberships")return {role:"member",state:"active"};
      if(parts[5]==="invitations")return team.invitations;
    }
    if(repo && parts.length===4)return {private:true,visibility:"private",archived:false,default_branch:"main",owner:{type:"Organization"},permissions:{admin:true}};
    if(repo && parts[4]==="teams")return this.teams.filter(t=>t.grants[repo]).map(t=>({id:t.id,slug:t.slug,permission:t.grants[repo]}));
    if(repo && parts[4]==="invitations")return [];
    if(repo && parts[4]==="rulesets")return parts.length===5?this.rules[repo]:this.rules[repo]!.find(r=>r.id===Number(parts[5]));
    if(repo && parts[4]==="collaborators") {
      const grants={...this.direct[repo]};
      const rank:Record<string,number>={pull:1,push:3,maintain:4,admin:5};
      if(!path.includes("affiliation=direct"))for(const t of this.teams)if(t.grants[repo])for(const m of t.members) {
        if((rank[t.grants[repo]!]??0)>(rank[grants[m]??""]??0))grants[m]=t.grants[repo]!;
      }
      return Object.entries(grants).map(([login,role_name])=>({login,role_name,type:this.unknownActor?"Bot":"User"}));
    }
    throw new Error(`Unexpected read ${path}`);
  }
}
const prepare=async(api:Api,g=graph())=>planGithub(api,g.definition,g.users);
const apply=async(api:Api,g=graph())=>applyGithub(api,g.definition,g.users,(await prepare(api,g)).revision);

test("onboarding reconciles dedicated team, preserves read-only access and converges",async()=>{
  const api=new Api();const p=await prepare(api);
  expect(p.blockers).toEqual([]);
  expect(p.changes.some(c=>c.path.endsWith("memberships/ben"))).toBe(true);
  expect(p.changes.some(c=>c.path.endsWith("memberships/cleo"))).toBe(false);
  const report=await apply(api);expect(report.status).toBe("applied");
  expect(api.teams[0]!.members.sort()).toEqual(["ada","ben"]);
  expect(api.direct["acme/kb"]!.cleo).toBe("pull");
  expect((await prepare(api)).changes).toEqual([]);
  expect(api.writes.findIndex(w=>w.path.endsWith("memberships/ben"))).toBeGreaterThan(api.writes.findIndex(w=>(w.body as any)?.name==="merovingian-reviewed-changes"));
});
test("membership-only changes leave existing protections untouched",async()=>{
  const api=new Api();await apply(api);api.teams[0]!.members=["ada"];api.writes=[];
  const p=await prepare(api);expect(p.changes).toHaveLength(1);
  expect(p.changes[0]!.path).toEndWith("memberships/ben");
  expect((await apply(api)).status).toBe("applied");
  expect(api.writes.some(w=>w.path.includes("rulesets"))).toBe(false);
});
test("revocation removes team access and direct access, retaining separate read grants",async()=>{
  const api=new Api();await apply(api);api.direct["acme/kb"]!.ben="push";
  const g=graph();g.users.ben!.assignments=[{purpose:"readers",role:"member"}];
  const p=await prepare(api,g);expect(p.blockers).toEqual([]);
  expect((await apply(api,g)).status).toBe("applied");
  expect(api.teams[0]!.members).not.toContain("ben");expect(api.direct["acme/kb"]!.ben).toBe("pull");
});
test("missing write grant is planned explicitly; grant downgrades precede additions",async()=>{
  for(const permission of [undefined,"pull","admin"]) {
    const api=new Api();if(permission)api.teams[0]!.grants["acme/kb"]=permission;else delete api.teams[0]!.grants["acme/kb"];
    const p=await prepare(api);expect(p.blockers).toEqual([]);
    expect(p.changes).toContainEqual(expect.objectContaining({path:"/orgs/acme/teams/reviewers/repos/acme/kb",body:{permission:"push"}}));
    expect((await apply(api)).status).toBe("applied");
    expect(api.writes.findIndex(w=>w.path.includes("/teams/reviewers/repos/"))).toBeLessThan(api.writes.findIndex(w=>w.path.endsWith("memberships/ben")));
  }
});
test("compatible shared teams are reconciled once with all affected repositories",async()=>{
  const api=new Api();api.teams[0]!.grants["acme/kb2"]="push";
  const g=graph();g.definition.github!.repositories["acme/kb2"]={reviewTeam:"reviewers",allowApproverPullRequestBypass:false};
  const p=await prepare(api,g);expect(p.blockers).toEqual([]);
  const membership=p.changes.filter(c=>c.path.includes("memberships"));expect(membership).toHaveLength(1);
  expect(membership[0]!.affectedRepositories).toEqual(["acme/kb","acme/kb2"]);
  expect((await apply(api,g)).status).toBe("applied");
});
test("out-of-scope shared grants, nesting, missing authority and missing teams fail closed",async()=>{
  for(const mutate of [
    (a:Api)=>{a.teams[0]!.grants["acme/private-other"]="push";},
    (a:Api)=>{a.teams[0]!.parent={id:9};},
    (a:Api)=>{a.teams[0]!.children=[{id:9}];},
    (a:Api)=>{a.authority="member";},
    (a:Api)=>{a.teams=[];},
    (a:Api)=>{a.unknownActor=true;},
  ]) {
    const api=new Api();mutate(api);const p=await prepare(api);expect(p.blockers.length).toBeGreaterThan(0);
    const g=graph();await expect(applyGithub(api,g.definition,g.users,p.revision)).rejects.toThrow("blocked");expect(api.writes).toEqual([]);
  }
});
test("pending org/team invitations never become active access or trigger an org invitation",async()=>{
  for(const isTeam of [false,true]) {
    const api=new Api();api.orgMembers=api.orgMembers.filter(m=>m!=="ben");
    api.orgInvitations=[{id:4,login:"ben"}];if(isTeam)api.teams[0]!.invitations=[{id:4,login:"ben"}];
    const p=await prepare(api);expect(p.blockers.join()).toContain("pending");expect(api.writes).toEqual([]);
    await expect(apply(api)).rejects.toThrow("blocked");
  }
});
test("unmanaged team mismatch remains a blocker; adoption is explicit",async()=>{
  const api=new Api(),g=graph();delete g.definition.github!.managedTeams;
  const p=await prepare(api,g);expect(p.blockers.join()).toContain("exactly");expect(p.teams).toEqual([]);
  expect(p.changes.some(c=>c.path.includes("/teams/"))).toBe(false);
});
test("conflicting reviewer/approver memberships are rejected",async()=>{
  const api=new Api(),g=graph();g.definition.github!.repositories["acme/kb"]!.requiredApprover="ada";
  g.definition.github!.repositories["acme/kb"]!.approverTeam="reviewers";
  expect((await prepare(api,g)).blockers.join()).toContain("conflicting");
});
test("required approver remains a singleton and obsolete member removal is verified before bypass",async()=>{
  const api=new Api(),g=graph();const policy=g.definition.github!.repositories["acme/kb"]!;
  Object.assign(policy,{requiredApprover:"ada",approverTeam:"approver",allowApproverPullRequestBypass:true});
  g.definition.github!.managedTeams!.push("acme/approver");
  api.teams.push({id:2,slug:"approver",parent:null,children:[],members:["ada","ben"],grants:{"acme/kb":"push"},invitations:[]});
  api.ignorePath="/teams/approver/memberships/ben";
  expect((await apply(api,g)).status).toBe("partial");expect(api.writes).toHaveLength(1);
  api.ignorePath="";api.writes=[];expect((await apply(api,g)).status).toBe("applied");
  expect(api.teams[1]!.members).toEqual(["ada"]);
  const review=api.rules["acme/kb"]!.find(r=>r.name==="merovingian-reviewed-changes")!;
  expect(review.bypass_actors).toEqual([{actor_id:2,actor_type:"Team",bypass_mode:"pull_request"}]);
  expect(api.rules["acme/kb"]!.find(r=>r.name==="merovingian-branch-integrity")!.bypass_actors).toEqual([]);
});
test("team drift requires all scope; fresh revision covers team access",async()=>{
  const api=new Api(),g=graph();
  for(const scope of ["permissions","protections"] as const)expect((await planGithub(api,g.definition,g.users,scope)).blockers.join()).toContain("--scope all");
  const p=await prepare(api);api.teams[0]!.grants["acme/other"]="pull";
  await expect(applyGithub(api,g.definition,g.users,p.revision)).rejects.toThrow("changed");expect(api.writes).toEqual([]);
});
test("partial team failure stops subsequent grants and a fresh plan safely resumes",async()=>{
  const api=new Api();api.failPath="memberships/ben";
  const report=await apply(api);expect(report.status).toBe("partial");
  expect(JSON.stringify(report)).not.toContain("private failure");expect(api.direct["acme/kb"]!.cleo).toBeUndefined();
  api.failPath="";expect((await apply(api)).status).toBe("applied");
});

test("ignored team grants stop membership additions and report remaining drift",async()=>{
  const api=new Api();api.teams[0]!.grants["acme/kb"]="pull";api.ignorePath="/teams/reviewers/repos/";
  const report=await apply(api);expect(report.status).toBe("partial");
  expect(report.remaining?.changes.some(c=>c.path.includes("/teams/reviewers/repos/"))).toBe(true);
  expect(api.writes.some(c=>c.path.includes("memberships/ben"))).toBe(false);
});
test("unrelated inherited access is not hidden by a managed-team revocation",async()=>{
  const api=new Api();api.teams[0]!.members.push("former");
  api.teams.push({id:2,slug:"manual",parent:null,children:[],members:["former"],grants:{"acme/kb":"push"},invitations:[]});
  const p=await prepare(api);expect(p.blockers.join()).toContain("manual grants excess access");
  await expect(apply(api)).rejects.toThrow("blocked");expect(api.writes).toEqual([]);
});
test("team mutation races stop before enabling bypass",async()=>{
  const api=new Api();api.teams[0]!.members.push("former");
  const original=api.request.bind(api);
  api.request=async(method,path,body)=>{
    const result=await original(method,path,body);
    if(method==="DELETE" && path.endsWith("memberships/former"))api.teams[0]!.members.push("unexpected");
    return result;
  };
  expect((await apply(api)).status).toBe("partial");
  expect(api.writes).toHaveLength(1);
});


test("team inventory rejects restricted or unverifiable credential visibility",async()=>{
  for(const headers of ["", "X-OAuth-Scopes: read:org", "X-OAuth-Scopes: repo", "X-OAuth-Scopes: public_repo, admin:org"]) {
    expect(()=>requireTeamInventoryScopes(headers)).toThrow("visibility");
  }
  expect(()=>requireTeamInventoryScopes("HTTP/2 200\r\nX-OAuth-Scopes: repo, read:org\r\n")).not.toThrow();
  const api=new Api();api.assertTeamInventoryAccess=async()=>{throw new Error("not visible");};
  expect((await prepare(api)).blockers.join()).toContain("restricted tokens");
  await expect(apply(api)).rejects.toThrow("blocked");expect(api.writes).toEqual([]);
});


test("fresh approval includes pending invitation inventory",async()=>{
  const api=new Api(),g=graph();const p=await prepare(api,g);
  api.teams[0]!.invitations=[{id:7,login:"ben"}];
  await expect(applyGithub(api,g.definition,g.users,p.revision)).rejects.toThrow("changed");
  expect(api.writes).toEqual([]);
});
test("organization names normalize consistently in repositories and managed teams",async()=>{
  const api=new Api(),g=graph();g.definition.github!.managedTeams=["Acme/reviewers"];
  g.definition.github!.repositories["Acme/kb"]=g.definition.github!.repositories["acme/kb"]!;
  delete g.definition.github!.repositories["acme/kb"];
  expect((await prepare(api,g)).blockers).toEqual([]);
  expect((await apply(api,g)).status).toBe("applied");
});
test("direct access reductions across all repositories precede new grants",async()=>{
  const api=new Api(),g=graph();api.teams[0]!.grants["acme/kb2"]="push";
  api.direct["acme/kb2"]={cleo:"admin",former:"push"};
  g.definition.github!.repositories["acme/kb2"]={reviewTeam:"reviewers",allowApproverPullRequestBypass:false};
  const p=await prepare(api,g);expect(p.blockers).toEqual([]);
  const addition=p.changes.findIndex(c=>c.path==="/repos/acme/kb/collaborators/cleo");
  const downgrade=p.changes.findIndex(c=>c.path==="/repos/acme/kb2/collaborators/cleo");
  const revocation=p.changes.findIndex(c=>c.path==="/repos/acme/kb2/collaborators/former");
  for(const index of [addition,downgrade,revocation])expect(index).toBeGreaterThanOrEqual(0);
  expect(downgrade).toBeLessThan(addition);
  expect(revocation).toBeLessThan(addition);
  expect((await apply(api,g)).status).toBe("applied");
});
test("batch onboarding does not reread every member role after each mutation",async()=>{
  const api=new Api(),g=graph();
  for(let i=0;i<25;i++) {
    const id=`writer-${i}`;g.users[id]={...g.users.ben!,id,github:id};api.orgMembers.push(id);
  }
  let roleReads=0;const original=api.request.bind(api);
  api.request=async(method,path,body)=>{
    if(method==="GET" && path.includes("/teams/") && path.includes("/memberships/"))roleReads++;
    return original(method,path,body);
  };
  expect((await apply(api,g)).status).toBe("applied");
  // Two plans with one existing member, 26 targeted addition checks, final audit with 27 members.
  expect(roleReads).toBe(55);
});


test("final audit detects existing and newly added member role changes without corrupting the plan revision",async()=>{
  for(const login of ["ada","ben"]) {
  const api=new Api();let changed=false;const original=api.request.bind(api);
  api.request=async(method,path,body)=>{
    const result=await original(method,path,body);
    if(method==="PUT" && path.endsWith("collaborators/cleo"))changed=true;
    if(changed && method==="GET" && path.endsWith(`memberships/${login}`))return {role:"maintainer",state:"active"};
    return result;
  };
  const report=await apply(api);expect(report.status).toBe("drift");
  expect("auditBlockers" in report && report.auditBlockers?.join()).toContain(`role for ${login} changed`);
  expect(report.remaining?.revision).toBe((await prepare(api)).revision);
  }
});


test("unrelated organization members and invitations are neither printed nor revisioned",async()=>{
  const api=new Api(),g=graph();const before=await prepare(api,g);
  api.orgMembers.push("unrelated-private-member");api.orgInvitations.push({id:98,login:"unrelated-private-invite"},{id:99,login:null});
  const after=await prepare(api,g);
  expect(after.revision).toBe(before.revision);
  expect(JSON.stringify(after)).not.toContain("unrelated-private");
  expect(after.teams[0]!.organizationMembers).toEqual(["ada","ben"]);
  api.orgMembers=api.orgMembers.filter(m=>m!=="ben");api.orgInvitations.push({id:100,login:"ben"});
  const changed=await prepare(api,g);expect(changed.revision).not.toBe(before.revision);
  expect(changed.blockers.join()).toContain("organization invitation pending");
});

test("repositories starting with rulesets do not turn access changes into protection writes",async()=>{
  for(const name of ["rulesets","rulesets-example"]) {
    const api=new Api(),g=graph(),repository=`acme/${name}`;
    g.definition.buckets[0]!.repo=repository;
    g.definition.github!.repositories[repository]=g.definition.github!.repositories["acme/kb"]!;
    delete g.definition.github!.repositories["acme/kb"];
    api.rules[repository]=[];api.direct[repository]={};delete api.teams[0]!.grants["acme/kb"];
    const p=await prepare(api,g);expect(p.blockers).toEqual([]);
    const rules=p.changes.findIndex(c=>(c.body as any)?.name==="merovingian-reviewed-changes");
    const grant=p.changes.findIndex(c=>c.path===`/orgs/acme/teams/reviewers/repos/${repository}`);
    expect(rules).toBeGreaterThanOrEqual(0);expect(grant).toBeGreaterThan(rules);
    expect((await apply(api,g)).status).toBe("applied");
    expect(api.direct[repository]!.cleo).toBe("pull");
    expect((await prepare(api,g)).changes).toEqual([]);
  }
});
