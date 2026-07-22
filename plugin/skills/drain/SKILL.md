---
name: drain
description: The heavy governance pass — drain the tenant's learning inbox (journal/friction) AND the in-flight decision log, synthesize tensions WITH the human, turn the agreed ones into graph/library changes and promote converged decisions into ratified records (decisions/), stamp everything drained, and close the git loop. Use when the human asks for a governance pass, to drain the inbox, or to review accumulated frictions, learnings and decisions.
allowed-tools: Bash, Read, Edit
---

# drain — the governance pass

Members work; the ambient `journal`/`friction` tools append what they learn and where they
snagged to the tenant's **inbox**, and `register-decision` appends the calls they made with no
policy behind them to the **decision log**. This skill is the other half of both loops:
governance reads what accumulated, synthesizes it into tensions **with the human**, and returns
the agreed ones as changes to the structure (`graph.yaml`), the behavior (`library/`) or the
jurisprudence (`decisions/` — ratified records). Friction in → structure out; decisions in →
policy out.

Human-triggered, never scheduled. Runs **inside the tenant repo** (the folder with `graph.yaml`).

## Preconditions

- You are in the tenant repo and `merovingian help` works.
- The working tree is clean (`git status`) — the pass gets its own branch.
- Surreal is reachable (`merovingian deploy plan` connects).
- Create the branch **before touching anything**: `git checkout -b governance/<YYYY-MM-DD>`.

## Step 1 — read the inbox AND the decision log (CLI, never queries)

```bash
merovingian inbox <ns>          # journal/friction: undrained, oldest first, full text
merovingian decisions <ns>      # in-flight decision log: domain, author, applied records
merovingian inbox <ns> --all    # (either surface) include drained history, if context helps
```

Entry anatomy (the formats live in the tenant's own `library/skills/{journal,friction}/format.md`):

- **journal** — sections `Done / Problems / Insights / Context gaps`. Mine **Context gaps** and
  **Problems**; Done/Insights are context, not tensions.
- **friction** — sections `Friction / Context / Cost / Could be`. The whole entry is signal.
  Each carries a **scope** (`scope <purpose>` or `scope root`) — whose problem the writer
  thinks it is — and possibly a `resolved via:` trace (already resolved locally).
- **decision log** — a call someone made mid-work, with its domain and the ratified records it
  applied (`applies: decision:…`). Every entry is a PROMOTION CANDIDATE (Step 4b).

## Step 1b — triage by scope (ADR 0014: you see everything; you don't fix everything)

Root sees every friction — that synoptic view is half the drain's value (three "stale KB"
frictions in three purposes are ONE systemic tension). But resolution is subsidiarity:

- **Yours** — structural/global (graph, library, engine, cross-purpose): keep it in the pass.
- **Theirs** — operational inside one purpose (its kb, its flows, its data): re-scope it down
  and DON'T act on it:
  ```bash
  merovingian inbox <ns> --rescope <id> --to <purpose>   # "não sou eu que resolvo"
  merovingian inbox <ns> --rescope <id> --to root         # fish a systemic one back up
  ```
- **Report, don't nag**: close the pass telling the human where local queues stand —
  "N frictions await local governance in `eventos` and `comercial`; recommend those run their
  `pending` pass" — a warning, never an obligation to act. Re-scoped entries are NOT drained
  by you; their purpose resolves them (same `drained` stamp, their hands, with a
  `resolved_through` trace you can audit later with `--all`).

## Step 2 — cluster into tensions

Group **by theme across entries**, not entry-by-entry. A tension is:

- one sentence naming the gap (is → could-be);
- its evidence — the `inbox:<id>`s behind it (keep them: they feed `--ids` later, and the human
  may ask for the raw text);
- a candidate answer: a graph change (purpose/bucket/assignment), a library change (skill/agent
  prompt), a missing tool, or a conscious no-op.

Few and strong beats many and shallow. One loud friction can be a tension; five journals brushing
the same wall definitely are.

## Step 3 — a conversation, not a report

Present **one tension at a time**, strongest first: the sentence, the evidence, your candidate
answer. Ask what the human thinks. Listen. Adjust. Only then move to the next.

Tensions can die here — the human saying "that's fine as is" is a valid outcome (it still counts
as drained: seen, destination given). **Never** dump all tensions and proposals in one message.

## Step 4 — make the agreed changes

The normal change loop (the `merovingian` operations skill has the details): edit `graph.yaml`
and/or `library/` → `merovingian deploy plan` → the human sees the diff → `merovingian deploy
apply` (deletions need `--yes`, only after the human saw the plan). Several tensions can land in
one plan/apply.

## Step 4b — promote decisions into jurisprudence

Read the decision log as a court reads cases:

- **Convergence promotes**: three logs making the same call is a screaming candidate; even ONE
  log the human confirms as policy is enough. Promotion = write
  `decisions/<domain>/NNNN-slug.md` (frontmatter: `status: accepted`, `title:`, `date:`) with
  the decision + rationale distilled from the logs — it ships on the same `deploy apply`.
- **The telemetry reads records too**: logs whose `applies:` cite a record are usage signal —
  many citations = load-bearing (be careful superseding it); a record no log ever cites is dead
  letter (candidate to supersede/retire); logs that *stretched* a record are revision pressure.
- **Accepted is immutable**: changing a ratified record means a NEW record with
  `supersedes: <old-id>` — the plan warns if you edit an accepted one in place. A record cited
  by logs cannot be deleted (the apply blocks, atomically).
- Discarding is valid: a log the human rules "one-off, not policy" is still drained.

## Step 5 — stamp drained

After the changes land (or the human closes the pass), stamp BOTH surfaces:

```bash
merovingian inbox <ns> --drain                        # journal/friction
merovingian decisions <ns> --drain                    # decision log
merovingian decisions <ns> --drain --ids <id1>,<id2>  # partial pass: only what was covered
```

Semantics: **drained = "governance saw it and gave it a destination"** — resolved, deferred, or
consciously dismissed. It does NOT mean "fixed". Never stamp before the human has seen the
tensions. Entries are never deleted; `--all` audits the history.

## Step 6 — close the git loop

On the `governance/<date>` branch: conventional commit(s) describing the pass (what tensions,
what changed). Then:

- Repo **has a remote** → **ask the human** before opening a PR (`gh pr create`); they may prefer
  to push the branch and review later.
- **No remote** → merge the branch into `main` locally and delete it.

## Guardrails

- Every contact with Surreal goes through the CLI (`merovingian inbox`, `merovingian decisions`,
  `--drain`, `deploy`) — never a direct query.
- Never WRITE inbox or decision-log entries — `journal`/`friction`/`register-decision` belong to
  the members' workspaces.
- Ratified records are authored ONLY as files in `decisions/` (shipped by deploy) — never
  inserted into the db by hand.
- Never touch business rows; structure, prompts and jurisprudence only.
- Always `deploy plan` before `deploy apply`; never stamp `--drain` before the conversation.
