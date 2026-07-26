---
name: friction
description: Record one atomic friction into the learning inbox (via MCP) — the gap between what is and what could be. Use when something caused friction, confusion, a blocker, or an improvement opportunity appeared.
argument-hint: optional hint about the friction
---

# friction

Record a friction — the gap between what **is** and what **could be** — **atomically**,
in the moment, with the context fresh. The skill is the **method** (capture it
well-formed); the record goes to the `inbox` table in Surreal via the **`friction`
tool of the inbox MCP** (append-only, `user` stamped server-side, drained only by
governance). **Never write to disk.**

Frictions are the fuel of governance.

## Steps

1. **Identify the friction** in the recent interaction: what ground, confused,
   blocked, or what improvement opportunity appeared. If the human gave a hint
   (`$ARGUMENTS`), use it as direction; otherwise take the most relevant recent one.

2. **Assemble the record** as structured markdown, in the shape of the sibling
   `format.md` file. Be rich and specific **in the record** (not in
   the reply).

3. **Scope it — whose problem is this?** The criterion is the MOUNTS: who has the
   context and access to actually fix it?
   - Your purpose can fix it (its kb, its data, its skills) → `scope` = your purpose.
   - It needs a wider reach (a parent's mandate, cross-purpose) → `scope` = that
     ancestor. Escalation happens HERE, at creation — pick the ancestor now.
   - Structural / engine / you can't tell → omit `scope` (the root governance queue).

4. **Write to the inbox**: call the **`friction` tool** (of the `inbox` MCP server)
   with the markdown as the `text` argument, **`origin` = who you are right now**
   (the purpose/agent acting — a subagent names itself, not the shell that dispatched
   it) and the **`scope`** from step 3. Each friction is a separate append.

5. **Confirm in one sentence.** E.g. "Friction recorded (scope: delivery): X and Y
   terms are easily confused." No essay, no follow-up.

## Notes

- **Speed first.** Identify, assemble, write, confirm. Don't read old records, don't
  analyze, don't merge.
- **No disk.** If the tool is unavailable (no inbox MCP), say so instead of falling
  back to a file.
- Write for the reader: governance drains these to propose improvements.
