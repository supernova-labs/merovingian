import { z } from "zod";
import { canonical } from "../catalog/catalog.ts";
import type { Definition, User } from "../provider/types.ts";
import { list, type GithubApi, type Snapshot } from "./api.ts";
import type { DesiredRepository } from "./policy.ts";
import type { Change, Scope } from "./reconcile.ts";

const person = z.object({ login: z.string(), type: z.literal("User") });
const invitation = z.object({ id: z.number().int(), login: z.string().nullable() });
export interface ManagedTeam {
  key: string; id: number; slug: string; parent: number | null; children: number[];
  members: { login: string; role: "member" | "maintainer"; state: "active" | "pending" }[];
  invitations: { id: number; login: string | null }[];
  repositories: string[];
  organizationMembers: string[];
  organizationInvitations: { id: number; login: string | null }[];
  expected: string[]; targets: string[];
}

/** Paginated boundary read without a separate membership-role request per person. */
export async function inspectTeamBoundary(api: GithubApi, key: string) {
  const [org, slug] = key.split("/") as [string, string];
  const base = `/orgs/${org}/teams/${slug}`;
  const team = z.object({ id: z.number().int(), slug: z.literal(slug), parent: z.object({ id: z.number().int() }).nullable() })
    .parse(await api.request("GET", base));
  const children = z.array(z.object({ id: z.number().int() })).parse(await list(api, `${base}/teams`));
  const repositories = z.array(z.object({ full_name: z.string() })).parse(await list(api, `${base}/repos`));
  const people = z.array(person).parse(await list(api, `${base}/members?role=all`));
  return { key, id: team.id, slug, parent: team.parent?.id ?? null, children: children.map(t => t.id).sort((a,b)=>a-b),
    repositories: repositories.map(r=>r.full_name.toLowerCase()).sort(), members: people.map(p=>p.login.toLowerCase()).sort(),
    invitations: normalizeInvitations(await list(api, `${base}/invitations`)) };
}
function normalizeInvitations(items: unknown[]) {
  return z.array(invitation).parse(items).map(i => ({ ...i, login: i.login?.toLowerCase() ?? null })).sort((a,b) => a.id-b.id);
}
/** Full organization-admin inventory is required: a repo admin may not see other private grants. */
export async function inspectManagedTeam(api: GithubApi, key: string, expected: string[], targets: string[]): Promise<ManagedTeam> {
  if (!api.assertTeamInventoryAccess) throw new Error("Cannot establish credential visibility");
  await api.assertTeamInventoryAccess();
  const [org, slug] = key.split("/") as [string, string];
  const authority = z.object({ state: z.literal("active"), role: z.literal("admin") });
  authority.parse(await api.request("GET", `/user/memberships/orgs/${org}`));
  const boundary = await inspectTeamBoundary(api, key);
  const members: ManagedTeam["members"] = [];
  for (const login of boundary.members) {
    const m = z.object({ role: z.enum(["member", "maintainer"]), state: z.enum(["active", "pending"]) })
      .parse(await api.request("GET", `/orgs/${org}/teams/${slug}/memberships/${encodeURIComponent(login)}`));
    members.push({ login, ...m });
  }
  return { ...boundary, members,
    organizationMembers: z.array(person).parse(await list(api, `/orgs/${org}/members?role=all`)).map(p=>p.login.toLowerCase()).sort(),
    organizationInvitations: normalizeInvitations(await list(api, `/orgs/${org}/invitations`)), expected, targets };
}

export async function planTeams(api: GithubApi, def: Definition, users: Record<string, User>, desired: DesiredRepository[], snapshots: Snapshot[], scope: Scope) {
  const inventory: ManagedTeam[] = [], changes: Change[] = [], blockers: string[] = [];
  const projected = structuredClone(snapshots);
  const managed = (def.github?.managedTeams ?? []).map(key=>key.toLowerCase());
  if (new Set(managed).size !== managed.length) blockers.push("Duplicate managedTeams declarations");
  for (const key of [...new Set(managed)].sort()) {
    const [org, slug] = key.split("/");
    const uses = desired.flatMap(t => t.repository.split("/")[0] !== org ? [] : [
      ...(t.policy.reviewTeam === slug ? [{ target: t, members: t.reviewers }] : []),
      ...(t.policy.approverTeam === slug ? [{ target: t, members: [users[t.policy.requiredApprover!]!.github!.toLowerCase()] }] : []),
    ]);
    if (!uses.length) { blockers.push(`${key}: managed team is not referenced by a selected repository policy`); continue; }
    const expected = uses[0]!.members;
    if (uses.some(u=>canonical(u.members)!==canonical(expected))) {
      blockers.push(`${key}: conflicting desired memberships across review/approver policies; use separate teams`); continue;
    }
    const targets = [...new Set(uses.map(u=>u.target.repository))].sort();
    let team: ManagedTeam;
    try { team = await inspectManagedTeam(api, key, expected, targets); }
    catch { blockers.push(`${key}: cannot establish complete team inventory. Verify the existing team and organization-owner credentials using a classic/OAuth credential with repo and organization scopes; restricted tokens are unsupported and missing teams are not created.`); continue; }
    inventory.push(team);
    const block = (message: string) => blockers.push(`${key}: ${message}`);
    if (team.parent !== null || team.children.length) block("nested teams have inherited effects; use a standalone team");
    if (team.repositories.some(r=>!targets.includes(r))) block(`repository access outside declared team targets: ${team.repositories.filter(r=>!targets.includes(r)).join(", ")}; narrow the team or include compatible policies`);
    if (team.invitations.length || team.members.some(m=>m.state!=="active")) block("pending team invitations/memberships require acceptance or explicit cancellation before reconciliation");
    for (const login of expected) if (!team.organizationMembers.includes(login)) {
      block(`${login}: ${team.organizationInvitations.some(i=>i.login===login) ? "organization invitation pending" : "not an active organization member"}; complete organization onboarding first`);
    }
    const edits: Change[] = [];
    const base = `/orgs/${org}/teams/${slug}`;
    for (const m of team.members) if (!expected.includes(m.login)) edits.push({ repository: targets[0]!, affectedRepositories: targets,
      description: `remove ${m.login} from managed team ${key}`, method: "DELETE", path: `${base}/memberships/${encodeURIComponent(m.login)}` });
    for (const login of expected) if (!team.members.some(m=>m.login===login && m.state==="active")) edits.push({ repository: targets[0]!, affectedRepositories: targets,
      description: `add active organization member ${login} to managed team ${key}`, method: "PUT", path: `${base}/memberships/${encodeURIComponent(login)}`, body: { role: "member" } });
    for (const repository of targets) {
      const current = snapshots.find(s=>s.repository===repository)!;
      const grant = current.teams.find(t=>t.slug===slug);
      if (grant && grant.id !== team.id) block(`inconsistent team identity for ${repository}`);
      if (grant && canonical(grant.members) !== canonical(team.members.filter(m=>m.state==="active").map(m=>m.login))) block(`inconsistent membership inventory for ${repository}; re-plan`);
      if (Boolean(grant) !== team.repositories.includes(repository)) block(`inconsistent repository grant inventory for ${repository}; re-plan`);
      if (grant && !["read", "pull", "triage", "write", "push", "maintain", "admin"].includes(grant.permission)) block(`unknown team permission for ${repository}`);
      if (!grant || !["push", "write"].includes(grant.permission)) edits.push({ repository, affectedRepositories: [repository],
        description: `set managed team ${key} to push on ${repository}`, method: "PUT", path: `${base}/repos/${repository}`, body: { permission: "push" } });
    }
    if (scope !== "all" && edits.length) block("team membership/grant drift requires --scope all to preserve review and access invariants");
    // A projected snapshot is only used to plan dependent ACL/protection changes, never as evidence of actual access.
    if (blockers.some(b=>b.startsWith(`${key}:`))) continue;
    changes.push(...edits);
    for (const repository of targets) {
      const s = projected.find(s=>s.repository===repository)!;
      s.teams = s.teams.filter(t=>t.slug!==slug);
      s.teams.push({ id: team.id, slug: team.slug, permission: "push", members: [...expected] });
    }
  }
  // Recompute effective access only for actors touched by managed teams, using all observed grant sources.
  const rank: Record<string, number> = { none:0, read:1, pull:1, triage:2, write:3, push:3, maintain:4, admin:5 };
  for (const s of projected) {
    const before = snapshots.find(b=>b.repository===s.repository)!;
    const changed = inventory.filter(t=>t.targets.includes(s.repository) && changes.some(c=>c.path.startsWith(`/orgs/${t.key.split("/")[0]}/teams/${t.slug}/`)));
    const affected = new Set(changed.flatMap(t=>[...t.members.map(m=>m.login), ...t.expected]));
    for (const login of affected) {
      const observed = before.collaborators.find(c=>c.login===login);
      const sources = (snap: Snapshot) => [snap.basePermission, snap.organizationAdmins.includes(login)?"admin":"none",
        ...snap.direct.filter(c=>c.login===login).map(c=>c.role_name), ...snap.teams.filter(t=>t.members.includes(login)).map(t=>t.permission)];
      const oldSources = sources(before);
      if (observed && (observed.type!=="User" || rank[observed.role_name]===undefined || oldSources.some(r=>rank[r]===undefined) ||
          rank[observed.role_name] !== Math.max(...oldSources.map(r=>rank[r]!)))) {
        blockers.push(`${s.repository}: cannot attribute effective access for ${login}; resolve inherited/custom grants before team reconciliation`); continue;
      }
      const grants = sources(s);
      if (grants.some(r=>rank[r]===undefined)) { blockers.push(`${s.repository}: unknown grant for ${login}`); continue; }
      const effective = grants.sort((a,b)=>rank[b]!-rank[a]!)[0]!;
      s.collaborators = s.collaborators.filter(c=>c.login!==login);
      if (rank[effective]!>0) s.collaborators.push({ login, type:"User", role_name:effective });
    }
  }
  return { inventory, changes, blockers, projected };
}
