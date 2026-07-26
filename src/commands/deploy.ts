// `merovingian deploy plan|apply <ns>` — the declarative deploy (ADR 0009).
//
//   plan   — read-only audit: validate yaml → drift (yaml × Surreal) → gh existence.
//   apply  — converge Surreal to the yaml: upsert desired, reconcile edges, delete
//            (referrer-safe, atomic-on-block, --yes-gated). Structure only.
//
// Exit codes (set by the caller): plan  2=invalid · 1=drift · 0=sync.
//                                 apply 2=invalid · 1=needs-confirm/blocked · 0=applied.

import { dirname } from "node:path";
import { loadGraphFile, resolveGraphPath } from "../graph/load-graph.ts";
import { desiredState, planGraph, planIsEmpty, validateGraph, type GraphPlan } from "../graph/plan.ts";
import { applyGraph, readCurrentState, GraphValidationError, type ApplyReport, type ApplyStatus } from "../graph/apply.ts";
import { checkExternal, type ExternalCheck } from "../graph/external-check.ts";
import { connectSurreal, surrealConfig } from "../provider/surreal.ts";
import { connectionOverrides } from "../tenant-config.ts";

function loadDesired(graph?: string): ReturnType<typeof loadGraphFile> & { tenantDir: string } {
  const path = resolveGraphPath(graph);
  return { ...loadGraphFile(path), tenantDir: dirname(path) };
}

// ─── plan ──────────────────────────────────────────────────────────────────

export interface PlanResult {
  validationErrors: string[];
  plan: GraphPlan | null;
  external: ExternalCheck | null;
}

export async function deployPlan(opts: { graph?: string } = {}): Promise<PlanResult> {
  const { definition, users, warnings, tenantDir } = loadDesired(opts.graph);
  const namespace = definition.namespace;
  for (const warning of warnings) console.warn(`⚠ ${warning}`);

  const validationErrors = validateGraph(definition, users);
  if (validationErrors.length) {
    renderValidation(namespace, validationErrors);
    return { validationErrors, plan: null, external: null };
  }

  const desired = desiredState(definition, users);
  const conn = await connectionOverrides(tenantDir, namespace);
  const db = await connectSurreal(surrealConfig(namespace, conn));
  let current;
  try {
    current = await readCurrentState(db, namespace);
  } finally {
    await db.close();
  }
  const plan = planGraph(desired, current);
  const external = await checkExternal(definition);

  console.log(`deploy plan · ${namespace}  (audit-first — nothing will be applied)\n`);
  renderDiff(plan);
  renderExternal(external);
  return { validationErrors, plan, external };
}

// ─── apply ─────────────────────────────────────────────────────────────────

export interface ApplyCliResult {
  status: ApplyStatus | "invalid";
  report?: ApplyReport;
  errors?: string[];
}

export async function deployApply(opts: { graph?: string; surrealDb?: string; yes?: boolean } = {}): Promise<ApplyCliResult> {
  const { definition, users, warnings, tenantDir } = loadDesired(opts.graph);
  const namespace = definition.namespace;
  for (const warning of warnings) console.warn(`⚠ ${warning}`);
  const conn = await connectionOverrides(tenantDir, namespace);
  const cfg = surrealConfig(namespace, { ...conn, ...(opts.surrealDb ? { db: opts.surrealDb } : {}) });
  const db = await connectSurreal(cfg);
  try {
    const report = await applyGraph(db, definition, users, { reset: false, confirmDeletes: opts.yes });
    renderApply(namespace, report);
    return { status: report.status, report };
  } catch (e) {
    if (e instanceof GraphValidationError) {
      renderValidation(namespace, e.errors);
      return { status: "invalid", errors: e.errors };
    }
    throw e;
  } finally {
    await db.close();
  }
}

// ─── rendering ───────────────────────────────────────────────────────────

function renderValidation(namespace: string, errors: string[]): void {
  console.log(`deploy · ${namespace}\n`);
  console.log(`✗ graph.yaml invalid — ${errors.length} authoring error(s):\n`);
  for (const e of errors) console.log(`  · ${e}`);
  console.log(`\nFix the graph.yaml before proceeding.`);
}

function changeLine(c: { field: string; from?: string; to?: string; added?: string[]; removed?: string[] }): string {
  if (c.added || c.removed) {
    const parts: string[] = [];
    if (c.added?.length) parts.push(`+${c.added.join(",")}`);
    if (c.removed?.length) parts.push(`-${c.removed.join(",")}`);
    return `${c.field}: ${parts.join(" ")}`;
  }
  return `${c.field}: ${c.from} → ${c.to}`;
}

function renderDiff(plan: GraphPlan): void {
  if (planIsEmpty(plan)) {
    console.log(`✓ Surreal in sync with graph.yaml — zero drift.`);
    return;
  }
  const n = plan.create.length + plan.delete.length + plan.update.length;
  console.log(`Δ ${n} change(s):\n`);
  for (const c of plan.create) console.log(`  + create  ${c.kind} ${c.id}`);
  for (const d of plan.delete) console.log(`  - delete  ${d.kind} ${d.id}`);
  for (const u of plan.update) {
    console.log(`  ~ change  ${u.kind} ${u.id}`);
    for (const ch of u.changes) console.log(`             ${changeLine(ch)}`);
  }
  // ADR 0011: the generator never DROPs — removing a bucket only removes the record.
  if (plan.delete.some((d) => d.kind === "bucket")) {
    console.log(`\n  note: removing a bucket does NOT drop its Surreal tables — the data stays until removed manually.`);
  }
  for (const w of plan.warnings) console.log(`\n  ⚠ ${w}`);
}

function renderExternal(external: ExternalCheck): void {
  console.log(`\nexternal repos (gh):`);
  if (external.skipped) {
    console.log(`  (skipped — ${external.reason})`);
    return;
  }
  for (const r of external.repos) console.log(`  ${r.exists ? "✓" : "✗"} ${r.kind === "kb" ? "kb " : "mkt"} ${r.repo}`);
  const missing = external.repos.filter((r) => !r.exists).length;
  if (missing) console.log(`  (${missing} repo(s) missing — manual checklist)`);
}

function renderApply(namespace: string, report: ApplyReport): void {
  console.log(`deploy apply · ${namespace}\n`);
  renderDiff(report.plan);

  if (report.status === "needs-confirm") {
    console.log(`\n⚠ ${report.plan.delete.length} pending deletion(s) — nothing was applied. Re-run with --yes to confirm.`);
  } else if (report.status === "blocked") {
    console.log(`\n✗ apply aborted (atomic) — deletion blocked by live data:`);
    for (const b of report.blocked ?? []) console.log(`  · ${b.kind} ${b.id} — referenced by ${b.referrers.join(", ")}`);
    console.log(`\nRe-point or remove those records before deleting.`);
  } else {
    const a = report.applied!;
    console.log(`\n✓ applied: +${a.created} created · ~${a.updated} changed · -${a.deleted} deleted.`);
  }
}
