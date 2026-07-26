---
name: pending
description: The LOCAL governance pass — list and clear the pending frictions within your reach (via the inbox MCP). Invoked BY THE HUMAN when they want to tend the queue; never run it spontaneously at session start or mid-task.
argument-hint: optional purpose to tend (defaults to the purpose you are acting in)
---

# pending

Tend the frictions scoped to your reach: resolve what is **operational** (your mounts
can fix it), escalate what is **structural**. This is the local half of governance
(ADR 0014) — the root drain keeps the synoptic view; you keep your own house.

**Only when the human asks.** Never call `pending` spontaneously — not at session
start, not mid-task. The human invokes the cleanup; you do it with them.

## Steps

1. **List**: call the **`pending` tool** (of the `inbox` MCP server). The database
   filters by your real reach — what you see is what you may act on.

2. **Filter to where you are acting.** If your reach is wide (an owner high in the
   tree sees everything scoped below), don't tend it all — that's the root drain's
   job, not yours. Work the frictions scoped to the purpose you are acting in (or
   the one the human named in `$ARGUMENTS`); mention the rest in one line.

3. **For each friction, decide with the human** (one at a time, oldest first):
   - **Operational** — your mounts (kb, data, skills) can fix it? Fix it now: edit
     the kb, run the flow, commit where the content lives. Then call the
     **`resolve` tool** with `resolvedThrough` = the trace (PR/commit link, doc,
     or a one-line description). The trace is what makes the resolution auditable.
   - **Misrouted within your reach** — belongs to a sibling/child purpose you can
     see? **`rescope`** it there.
   - **Structural / beyond your reach** — engine, graph, another branch of the
     tree? Leave it: say so, and note it for the root drain (re-scoping beyond
     your reach is root's move). If it was born mis-scoped to you, `rescope` it
     up as far as your reach allows. **A skill/agent prompt is ALWAYS structural**
     — your `.claude/` copy is a projection the next build overwrites; the real
     one is desired state in the tenant repo's `library/`, governance's to edit.
   - **Partially yours** — the friction asks for an operational fix AND a
     structural one? **Split it**: do your half now, `resolve` the friction with
     your half's trace, and register the remainder as a NEW atomic friction
     (friction tool) scoped to whoever owns the rest (usually unscoped = the
     root queue), citing the resolved one. Two problems, two rows — queues stay
     honest and nothing lingers half-done.
   - **Propose, don't just point.** When the structural fix touches a skill you
     carry, you HAVE its content (the harness skill directory is a byte-identical
     materialized copy) — write the CONCRETE change into the friction (the new
     step's text, where it lands, what it references). Governance ratifies a
     ready proposal instead of investigating a complaint. Propose ≠ apply: the
     real file is desired state in the tenant repo's `library/`, and only
     governance edits it.

4. **Journal the pass** (journal skill, `origin` = the purpose you acted in): what
   was resolved (with traces), what was left and why. The root drain reads this.

## Notes

- Resolving stamps `drained` — the SAME stamp the root drain uses. One lifecycle,
  two hands.
- Content is immutable; you never edit a friction — you resolve, move, or leave it.
- If `resolve`/`rescope` answer "not in your reach", that's the database talking —
  don't fight it; note it for the drain.
