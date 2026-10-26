import { z } from "zod";

export interface GithubApi {
  request(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown>;
  /** Required for team adoption: prove the credential cannot hide private repository grants. */
  assertTeamInventoryAccess?(): Promise<void>;
}
export function requireTeamInventoryScopes(headers: string): void {
  const scopes = new Set((headers.match(/^x-oauth-scopes:\s*([^\r\n]*)/im)?.[1] ?? "").split(",").map(s=>s.trim()));
  if (!scopes.has("repo") || !["read:org", "write:org", "admin:org"].some(s=>scopes.has(s))) {
    throw new Error("Managed team inventory requires a classic/OAuth credential with repo and organization scopes; restricted or unprovable token visibility is unsupported.");
  }
}
/** gh owns authentication. Neither credentials nor raw error bodies enter reports. */
export class GhApi implements GithubApi {
  async assertTeamInventoryAccess(): Promise<void> {
    const proc = Bun.spawn(["gh", "api", "--hostname", "github.com", "--include", "/user"], { stdout: "pipe", stderr: "pipe" });
    const [output, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error("Cannot verify GitHub credential visibility");
    // Only response headers are inspected. User data and authentication are never reported.
    requireTeamInventoryScopes(output.split(/\r?\n\r?\n/, 1)[0]!);
  }
  async request(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    if (!path.startsWith("/") || path.includes("..")) throw new Error("Invalid GitHub API path");
    const proc = Bun.spawn(["gh", "api", "--hostname", "github.com", "--method", method, path,
      "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28",
      ...(body === undefined ? [] : ["--input", "-"])], {
      stdin: body === undefined ? "ignore" : new Blob([JSON.stringify(body)]), stdout: "pipe", stderr: "pipe",
    });
    const [output, , code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`GitHub ${method} ${path.split("?")[0]} failed; check authentication, administrative permissions and repository availability.`);
    if (!output.trim()) return null;
    try { return JSON.parse(output); } catch { throw new Error("GitHub returned invalid JSON"); }
  }
}
export async function list(api: GithubApi, path: string): Promise<unknown[]> {
  const result: unknown[] = [];
  for (let page = 1; page <= 1000; page++) {
    const items = z.array(z.unknown()).parse(await api.request("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`));
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw new Error("GitHub pagination exceeded safety limit; refusing an incomplete inventory");
}
const Person = z.object({ login: z.string(), type: z.string() });
const Collaborator = Person.extend({ role_name: z.string() });
const Team = z.object({ id: z.number().int(), slug: z.string(), permission: z.string() });
const Invitation = z.object({ id: z.number().int(), invitee: Person.nullable(), permissions: z.string() });
export const Ruleset = z.object({ id: z.number().int(), name: z.string(), source_type: z.string(),
  target: z.string(), enforcement: z.string(), bypass_actors: z.array(z.unknown()), conditions: z.unknown(), rules: z.array(z.unknown()) });
export type Rule = z.infer<typeof Ruleset>;
export interface Snapshot {
  repository: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  admin: boolean;
  organization: boolean;
  basePermission: string;
  organizationAdmins: string[];
  collaborators: z.infer<typeof Collaborator>[];
  direct: z.infer<typeof Collaborator>[];
  invitations: z.infer<typeof Invitation>[];
  teams: (z.infer<typeof Team> & { members: string[] })[];
  rulesets: Rule[];
}
export async function inspectRepository(api: GithubApi, repository: string): Promise<Snapshot> {
  const base = `/repos/${repository}`;
  const repo = z.object({ private: z.boolean(), visibility: z.string(), archived: z.boolean(), default_branch: z.string(),
    owner: z.object({ type: z.string() }), permissions: z.object({ admin: z.boolean() }) }).parse(await api.request("GET", base));
  if (repo.owner.type !== "Organization") throw new Error(`${repository}: first release supports organization repositories only`);
  if (!repo.permissions.admin) throw new Error(`${repository}: administrative GitHub access is required`);
  const org = repository.split("/")[0]!;
  const organization = z.object({ default_repository_permission: z.string() }).parse(await api.request("GET", `/orgs/${org}`));
  const admins = z.array(Person).parse(await list(api, `/orgs/${org}/members?role=admin`));
  const collaborators = z.array(Collaborator).parse(await list(api, `${base}/collaborators?affiliation=all`));
  const direct = z.array(Collaborator).parse(await list(api, `${base}/collaborators?affiliation=direct`));
  const invitations = z.array(Invitation).parse(await list(api, `${base}/invitations`));
  const teams = [];
  for (const t of z.array(Team).parse(await list(api, `${base}/teams`))) {
    const members = z.array(Person).parse(await list(api, `/orgs/${org}/teams/${encodeURIComponent(t.slug)}/members?role=all`));
    if (members.some(m => m.type !== "User")) throw new Error(`${repository}: team ${t.slug} contains an unsupported actor`);
    teams.push({ ...t, members: members.map(m => m.login.toLowerCase()).sort() });
  }
  const rulesets: Rule[] = [];
  const summaries = z.array(z.object({ id: z.number().int(), source_type: z.string() })).parse(await list(api, `${base}/rulesets?includes_parents=true`));
  for (const s of summaries) {
    // Inherited rules are never overwritten. Their complete configuration must be inspectable.
    const rule = Ruleset.parse(await api.request("GET", `${base}/rulesets/${s.id}`));
    rulesets.push(rule);
  }
  return { repository, private: repo.private && repo.visibility === "private", archived: repo.archived, defaultBranch: repo.default_branch,
    admin: repo.permissions.admin, organization: true, basePermission: organization.default_repository_permission,
    organizationAdmins: admins.map(a => a.login.toLowerCase()).sort(),
    collaborators: collaborators.map(c => ({ ...c, login: c.login.toLowerCase() })).sort((a,b) => a.login.localeCompare(b.login)),
    direct: direct.map(c => ({ ...c, login: c.login.toLowerCase() })).sort((a,b) => a.login.localeCompare(b.login)),
    invitations: invitations.map(i => ({ ...i, invitee: i.invitee ? { ...i.invitee, login: i.invitee.login.toLowerCase() } : null })).sort((a,b) => a.id-b.id),
    teams: teams.sort((a,b) => a.id-b.id), rulesets: rulesets.sort((a,b) => a.id-b.id) };
}
