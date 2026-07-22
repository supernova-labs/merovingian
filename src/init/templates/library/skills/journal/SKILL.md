---
name: journal
description: Record the session's progress, problems, insights and context gaps into the learning inbox (via MCP). Use when closing a session, at a checkpoint, or to document what was done.
argument-hint: optional hint about what to record
---

# journal

Record a session snapshot — done, problems, insights and **context gaps** — into the
**learning inbox**. The skill is the **method** (what is worth capturing); the record
goes to the `inbox` table in Surreal via the **`journal` tool of the inbox MCP**
(append-only, `user` stamped server-side, drained only by governance). **Never write
to disk.**

## Steps

0. **Close the work before narrating it.** Walk the repos this session touched — the
   `context/` mounts (every kb is a git repo) and anything else you wrote to — and
   run `git status` on each. Uncommitted work → propose the commit to the human NOW
   (conventional message, one commit per subject; push is the human's call). The
   journal you are about to write cites those hashes as evidence — uncommitted work
   is memory that evaporates.

1. **Analyze the session** since the last checkpoint (or the start):
   - **Done** — what happened (use relative timestamps: "10:30", "afternoon")
   - **Problems** — blockers or issues that did not become frictions
   - **Insights** — important decisions, learnings

2. **Identify context gaps** — the most valuable part (it feeds governance). Read
   `${CLAUDE_SKILL_DIR}/context-gaps.md` for the patterns (knowledge with no home,
   undocumented process, skill candidate, inadequate structure). For each gap: what
   was discovered, where it should live, which kind.

3. **Assemble the record** as structured markdown, in the shape of
   `${CLAUDE_SKILL_DIR}/format.md`. Be rich here — governance reads this later.

4. **Write to the inbox**: call the **`journal` tool** (of the `inbox` MCP server)
   with the assembled markdown as the `text` argument, and **`origin` = who you are
   right now** — the purpose/agent acting (e.g. `delivery`, `shell`; a subagent names
   itself, not the shell that dispatched it). The drain reads origin to know where
   the learning lives. Every call is a new append (the inbox stamps `user` and `at`)
   — never try to find-and-update a previous one.

5. **Confirm in one sentence.** E.g. "Journal recorded: round 2 validated; 1 context
   gap." The richness goes in the record, not the reply.

## Notes

- **No disk.** If you catch yourself reaching for `Write` into a journals folder,
  stop — the destination is the `journal` tool.
- If the tool is unavailable (a build without the inbox MCP / offline), say the inbox
  is not mounted instead of falling back to a file.
- Several journals in one session = several appends (each timestamped). That's fine.
