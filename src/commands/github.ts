import { parseArgs } from "node:util";
import { loadGraphFile, resolveGraphPath } from "../graph/load-graph.ts";
import { GhApi } from "../github/api.ts";
import { applyGithub, planGithub, type Scope } from "../github/reconcile.ts";

/** Separate provider invocation: GitHub deployment never requires a database password. */
export async function deployGithub(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    graph: { type: "string" }, scope: { type: "string", default: "all" }, approve: { type: "string" },
  } });
  const command = positionals[0];
  if (positionals.length !== 1 || !["github-plan", "github-apply"].includes(command ?? "")) throw new Error("Use deploy github-plan|github-apply --graph PATH [--scope all|permissions|protections] [--approve sha256:…]");
  if (!["all", "permissions", "protections"].includes(values.scope!)) throw new Error("Invalid GitHub scope");
  if (command === "github-plan" && values.approve) throw new Error("Approval belongs to github-apply");
  if (command === "github-apply" && !/^sha256:[a-f0-9]{64}$/.test(values.approve ?? "")) throw new Error("github-apply requires --approve with the reviewed plan revision");
  const { definition, users } = loadGraphFile(resolveGraphPath(values.graph));
  const api = new GhApi(), scope = values.scope as Scope;
  if (command === "github-plan") {
    const plan = await planGithub(api, definition, users, scope);
    console.log(JSON.stringify(plan, null, 2));
    process.exitCode = plan.blockers.length ? 2 : plan.changes.length ? 1 : 0;
  } else {
    const report = await applyGithub(api, definition, users, values.approve!, scope);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === "applied" ? 0 : 1;
  }
}
