import { inspectManagedTeam, planTeams, type ManagedTeam } from "./teams.ts";
import type { Definition, User } from "../provider/types.ts";
import { canonical, revisionOf } from "../catalog/catalog.ts";
import { githubDesired, type DesiredRepository } from "./policy.ts";
import { inspectRepository, type GithubApi, type Snapshot } from "./api.ts";

export type Scope = "all" | "permissions" | "protections";
export interface Change { repository: string; affectedRepositories?: string[]; description: string; method: "PUT" | "POST" | "DELETE"; path: string; body?: unknown }
export interface GithubPlan { revision: string; scope: Scope; desired: DesiredRepository[]; snapshots: Snapshot[]; teams: ManagedTeam[]; changes: Change[]; blockers: string[] }
const level: Record<string, number> = { none: 0, read: 1, pull: 1, triage: 2, write: 3, push: 3, maintain: 4, admin: 5 };
/** Compare required fields while tolerating API-added defaults; never ignore extra rules or bypass actors. */
function rulesMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every(e => actual.some(a => rulesMatch(a, e)));
  }
  if (expected !== null && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([k,v]) => rulesMatch((actual as Record<string, unknown>)[k], v));
  }
  return actual === expected;
}
const ruleName = "merovingian-reviewed-changes";

export function planRepository(target: DesiredRepository, current: Snapshot, users: Record<string, User>, scope: Scope) {
  const changes: Change[] = [], blockers: string[] = [];
  const repo = target.repository, base = `/repos/${repo}`;
  const block = (reason: string) => blockers.push(`${repo}: ${reason}`);
  if (!current.private) block("public/internal visibility cannot enforce the graph's read boundary (private repository required)");
  if (current.archived) block("repository is archived");
  if (!current.admin) block("administrative access is required");
  if (scope !== "protections") {
    if (current.basePermission !== "none") block("organization base permission must be none; changing organization-wide access is outside repository reconciliation");
    for (const login of current.organizationAdmins) if (target.access[login] !== "admin") block(`organization owner ${login} requires an explicit administrative exception`);
    for (const team of current.teams) {
      if (level[team.permission] === undefined) block(`unknown team permission ${team.permission}`);
      for (const login of team.members) {
        if ((level[team.permission] ?? Infinity) > (level[target.access[login] ?? "none"] ?? 0)) {
          block(`team ${team.slug} grants excess access to ${login}; remove or narrow its repository grant before applying`);
        }
      }
    }
    const direct = new Set(current.direct.map(c => c.login));
    for (const c of current.collaborators) {
      if (c.type !== "User" || level[c.role_name] === undefined) { block(`unsupported actor/role for ${c.login}`); continue; }
      const desired = target.access[c.login];
      if (!direct.has(c.login) && (level[c.role_name] ?? Infinity) > (level[desired ?? "none"] ?? 0)) {
        block(`inherited excess permission for ${c.login}; no organization membership will be removed implicitly`);
      }
    }
    for (const c of current.direct) {
      if (c.type !== "User" || level[c.role_name] === undefined) { block(`unsupported direct actor/role for ${c.login}`); continue; }
      const access = target.access[c.login];
      if (!access) changes.push({ repository: repo, description: `revoke direct access: ${c.login}`, method: "DELETE", path: `${base}/collaborators/${encodeURIComponent(c.login)}` });
      else if (level[c.role_name] !== level[access]) changes.push({ repository: repo, description: `set ${c.login} to ${access}`, method: "PUT", path: `${base}/collaborators/${encodeURIComponent(c.login)}`, body: { permission: access } });
    }
    const invitations = new Map<string, typeof current.invitations[number]>();
    for (const i of current.invitations) {
      if (!i.invitee || i.invitee.type !== "User" || level[i.permissions] === undefined) { block(`unmapped invitation ${i.id}`); continue; }
      if (invitations.has(i.invitee.login)) block(`duplicate pending invitations for ${i.invitee.login}`);
      invitations.set(i.invitee.login, i);
      if (level[i.permissions] !== level[target.access[i.invitee.login] ?? "none"]) changes.push({ repository: repo,
        description: `cancel outdated invitation for ${i.invitee.login}`, method: "DELETE", path: `${base}/invitations/${i.id}` });
    }
    for (const [login, permission] of Object.entries(target.access).sort(([a],[b]) => a.localeCompare(b))) {
      if (direct.has(login)) continue;
      const existing = current.collaborators.find(c => c.login === login);
      if (existing && level[existing.role_name] === level[permission]) continue;
      const invitation = invitations.get(login);
      if (invitation && level[invitation.permissions] === level[permission]) continue;
      changes.push({ repository: repo, description: `grant ${permission}: ${login} (may require invitation acceptance)`,
        method: "PUT", path: `${base}/collaborators/${encodeURIComponent(login)}`, body: { permission } });
    }
  }
  if (scope !== "permissions") {
    const teamFor = (slug: string, expected: string[]) => {
      const team = current.teams.find(t => t.slug === slug);
      if (!team || canonical(team.members) !== canonical([...expected].sort()) || (level[team.permission] ?? 0) < level.push!) {
        block(`review team ${slug} must have write access and exactly these members: ${expected.join(", ")}`);
        return undefined;
      }
      return { reviewer: { id: team.id, type: "Team" }, file_patterns: ["*", "**/*"], minimum_approvals: 1 };
    };
    if (!target.reviewers.length) block("no human with an owning purpose can review this repository");
    const reviewers = [teamFor(target.policy.reviewTeam, target.reviewers)];
    if (target.policy.requiredApprover && target.policy.approverTeam) {
      reviewers.push(teamFor(target.policy.approverTeam, [users[target.policy.requiredApprover]!.github!.toLowerCase()]));
    }
    const approverTeam = current.teams.find(t => t.slug === target.policy.approverTeam);
    const bypass = target.policy.allowApproverPullRequestBypass && approverTeam
      ? [{ actor_id: approverTeam.id, actor_type: "Team", bypass_mode: "pull_request" }] : [];
    const body = { name: ruleName, target: "branch", enforcement: "active", bypass_actors: bypass,
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [{ type: "pull_request", parameters: {
        required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
        require_last_push_approval: false, required_review_thread_resolution: true,
        required_reviewers: reviewers.filter(r => r !== undefined),
      } }] };
    // Install non-bypassable integrity first, including when upgrading the old combined ruleset.
    const integrity = { ...body, name: "merovingian-branch-integrity", bypass_actors: [],
      rules: [{ type: "deletion" }, { type: "non_fast_forward" }] };
    for (const desired of [integrity, body]) {
      const owned = current.rulesets.filter(r => r.name === desired.name);
      if (owned.length > 1 || owned.some(r => r.source_type !== "Repository")) block(`ambiguous or inherited ruleset: ${desired.name}`);
      const existing = owned[0];
      const currentBody = existing ? { name: existing.name, target: existing.target, enforcement: existing.enforcement,
        bypass_actors: existing.bypass_actors, conditions: existing.conditions, rules: existing.rules } : undefined;
      if (!rulesMatch(currentBody, desired)) changes.push({ repository: repo, description: `enforce ${desired.name} on the default branch`,
        method: existing ? "PUT" : "POST", path: `${base}/rulesets${existing ? `/${existing.id}` : ""}`, body: desired });
    }
  }
  return { changes, blockers };
}
export async function planGithub(api: GithubApi, def: Definition, users: Record<string, User>, scope: Scope = "all"): Promise<GithubPlan> {
  if (!["all", "permissions", "protections"].includes(scope)) throw new Error("Invalid GitHub scope");
  const desired = githubDesired(def, users);
  if (!desired.length) throw new Error("No GitHub repositories selected");
  const snapshots: Snapshot[] = [], changes: Change[] = [], blockers: string[] = [];
  for (const target of desired) {
    const snapshot = await inspectRepository(api, target.repository);
    snapshots.push(snapshot);
  }
  const teams = await planTeams(api, def, users, desired, snapshots, scope);
  changes.push(...teams.changes); blockers.push(...teams.blockers);
  for (const target of desired) {
    const plan = planRepository(target, teams.projected.find(s=>s.repository===target.repository)!, users, scope);
    changes.push(...plan.changes); blockers.push(...plan.blockers);
  }
  // Remove obsolete team members before enabling any new bypass. Protect before grants/additions.
  const priority = (c: Change) => c.path.includes("/memberships/") && c.method === "DELETE" ? 0
    : c.path.includes("/rulesets") ? 1 : c.path.includes("/teams/") && c.path.includes("/repos/") ? 2
    : c.path.includes("/memberships/") ? 3 : 4;
  changes.sort((a,b) => priority(a)-priority(b));
  const content = { scope, desired, snapshots, teams: teams.inventory, changes, blockers };
  return { revision: revisionOf(content), ...content };
}
export async function applyGithub(api: GithubApi, def: Definition, users: Record<string, User>, approval: string, scope: Scope = "all") {
  // Re-read all targets before the first write. An approved stale plan is never applied.
  const plan = await planGithub(api, def, users, scope);
  if (approval !== plan.revision) throw new Error("GitHub plan changed or was not approved; inspect a fresh plan and its revision");
  if (plan.blockers.length) throw new Error(`GitHub apply blocked: ${plan.blockers.join("; ")}`);
  const applied: Change[] = [];
  for (const change of plan.changes) {
    try {
      await api.request(change.method, change.path, change.body); applied.push(change);
      if (change.path.startsWith("/orgs/") && change.path.includes("/teams/")) {
        const [, , org, , slug] = change.path.split("/");
        const expected = plan.teams.find(t=>t.key===`${org}/${slug}`)!;
        const actual = await inspectManagedTeam(api, expected.key, expected.expected, expected.targets);
        if (actual.id !== expected.id || actual.parent !== null || actual.children.length || actual.repositories.some(r=>!expected.targets.includes(r)) || actual.invitations.length) {
          throw new Error("Team scope changed or membership is pending");
        }
        let expectedMembers = structuredClone(expected.members);
        for (const done of applied.filter(c=>c.path.startsWith(`/orgs/${org}/teams/${slug}/memberships/`))) {
          const login = decodeURIComponent(done.path.split("/").at(-1)!);
          expectedMembers = expectedMembers.filter(m=>m.login!==login);
          if (done.method === "PUT") expectedMembers.push({ login, role: "member", state: "active" });
        }
        expectedMembers.sort((a,b)=>a.login.localeCompare(b.login));
        if (canonical(actual.members) !== canonical(expectedMembers)) throw new Error("Team membership changed unexpectedly");
        if (change.path.includes("/memberships/")) {
          const login = decodeURIComponent(change.path.split("/").at(-1)!);
          const member = actual.members.find(m=>m.login===login);
          if (change.method === "DELETE" ? Boolean(member) : member?.state !== "active") throw new Error("Team membership was not enforced");
        } else {
          const snapshot = await inspectRepository(api, change.repository);
          const grant = snapshot.teams.find(t=>t.id===actual.id);
          if (!grant || !["push", "write"].includes(grant.permission)) throw new Error("Team grant was not enforced");
        }
      }
      if (change.path.includes("/rulesets")) {
        const snapshot = await inspectRepository(api, change.repository);
        const expected = change.body as { name: string };
        const matches = snapshot.rulesets.filter(r => r.name === expected.name && r.source_type === "Repository");
        if (matches.length !== 1 || !rulesMatch(matches[0], expected)) throw new Error("Protection was not enforced");
      }
    }
    catch {
      // Read-only recovery evidence; a failed request may still have reached GitHub.
      let remaining: GithubPlan | undefined;
      try { remaining = await planGithub(api, def, users, scope); } catch { /* Inventory may also be unavailable. */ }
      return { status: "partial" as const, applied, failed: change, remaining,
        message: "This operation failed or its resulting protection/team state could not be verified. It may have reached GitHub. No subsequent operations ran. Inspect remaining drift or obtain a fresh plan before retrying." };
    }
  }
  let after: GithubPlan;
  try { after = await planGithub(api, def, users, scope); }
  catch { return { status: "partial" as const, applied, message: "Writes completed but the final audit failed. Effective access is unverified; re-plan before retrying." }; }
  const pendingInvitations = after.snapshots.flatMap(s => s.invitations.map(i => ({ repository: s.repository, login: i.invitee?.login })));
  return { status: after.blockers.length || after.changes.length ? "drift" as const : pendingInvitations.length ? "awaiting-invitations" as const : "applied" as const,
    applied, remaining: after, pendingInvitations };
}
