import { z } from "zod";
import type { Definition, User } from "../provider/types.ts";
import { resolveCatalog } from "../catalog/catalog.ts";
import { validateGraph } from "../graph/plan.ts";

export const repositoryName = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
export const GithubPolicySchema = z.object({
  // User IDs, not free-form GitHub identities. Explicit operational exceptions.
  administrators: z.array(z.string()).default([]),
  // Explicit adoption of existing, non-nested teams. Keys are organization/slug.
  managedTeams: z.array(z.string().regex(/^[A-Za-z0-9-]+\/[a-z0-9-]+$/).transform(key => key.toLowerCase())).optional(),
  repositories: z.record(z.string().regex(repositoryName), z.object({
    reviewTeam: z.string().regex(/^[a-z0-9-]+$/),
    requiredApprover: z.string().optional(),
    approverTeam: z.string().regex(/^[a-z0-9-]+$/).optional(),
    allowApproverPullRequestBypass: z.boolean().default(false),
  }).strict()),
}).strict();
export type GithubPolicy = z.infer<typeof GithubPolicySchema>;
export type Access = "pull" | "push" | "admin";
export interface DesiredRepository {
  repository: string;
  access: Record<string, Access>;
  reviewers: string[];
  policy: GithubPolicy["repositories"][string];
}

/** Administrative graph projection; shares the member catalog's entitlement rules. */
export function githubDesired(def: Definition, users: Record<string, User>): DesiredRepository[] {
  const errors = validateGraph(def, users);
  if (errors.length) throw new Error(`Invalid graph: ${errors.join("; ")}`);
  if (!def.github) throw new Error("Declare github.repositories before managing GitHub access.");
  const policy = GithubPolicySchema.parse(def.github);
  const known = new Set<string>();
  for (const b of def.buckets) if (b.backend === "okf-repo" && b.repo) known.add(b.repo.toLowerCase());
  for (const m of Object.values(def.marketplaces)) for (const b of [m.claude, m.codex]) {
    if (b && repositoryName.test(b.source)) known.add(b.source.toLowerCase());
  }
  const identities = new Map<string, string>();
  for (const u of Object.values(users)) if (u.github) {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(u.github)) throw new Error(`Invalid GitHub login for ${u.id}`);
    const login = u.github.toLowerCase();
    if (identities.has(login)) throw new Error(`Duplicate GitHub identity: ${login}`);
    identities.set(login, u.id);
  }
  const loginFor = (id: string) => {
    const login = users[id]?.github?.toLowerCase();
    if (!login) throw new Error(`User ${id} needs an administrative GitHub mapping`);
    return login;
  };
  const admins = policy.administrators.map(loginFor);
  const result = new Map<string, DesiredRepository>();
  for (const [raw, p] of Object.entries(policy.repositories)) {
    const repository = raw.toLowerCase();
    if (!known.has(repository)) throw new Error(`${repository} is not a graph repository`);
    if (result.has(repository)) throw new Error(`Duplicate repository: ${repository}`);
    if (Boolean(p.requiredApprover) !== Boolean(p.approverTeam)) throw new Error(`${repository}: requiredApprover and approverTeam must be paired`);
    if (p.requiredApprover) loginFor(p.requiredApprover);
    if (p.allowApproverPullRequestBypass && !p.requiredApprover) throw new Error(`${repository}: manual PR bypass requires an approver`);
    result.set(repository, { repository, policy: p, access: {}, reviewers: [] });
  }
  // An explicit repository list is the mutation boundary. Undeclared sources are never touched.
  for (const user of Object.values(users)) {
    if (!user.assignments.length) continue;
    const catalog = resolveCatalog(def, user);
    const grants = new Map<string, Access>();
    for (const r of catalog.repositories) {
      const repo = r.repository.toLowerCase();
      if (r.access === "write" || !grants.has(repo)) grants.set(repo, r.access === "write" ? "push" : "pull");
    }
    for (const m of catalog.marketplaces) for (const b of m.bindings) {
      if (b.status === "available" && !grants.has(b.source.toLowerCase())) grants.set(b.source.toLowerCase(), "pull");
    }
    for (const [repo, access] of grants) {
      const target = result.get(repo);
      if (!target) continue;
      const login = loginFor(user.id);
      target.access[login] = access;
      if (access === "push") target.reviewers.push(login);
    }
  }
  for (const target of result.values()) {
    target.reviewers = [...new Set(target.reviewers)].sort();
    for (const login of admins) target.access[login] = "admin";
    if (target.policy.requiredApprover && !target.reviewers.includes(loginFor(target.policy.requiredApprover))) {
      throw new Error(`${target.repository}: required approver must have an owning purpose`);
    }
  }
  return [...result.values()].sort((a, b) => a.repository.localeCompare(b.repository));
}
