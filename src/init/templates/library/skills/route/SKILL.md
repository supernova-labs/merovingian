---
name: route
description: Route a request to the right purpose/persona of this workspace — everyone lands on the shell and route dispatches to whoever decides or executes it. Use when a request is not clearly of a single purpose, or at session start with no set destination.
allowed-tools: [Read, Glob, Grep, Agent]
---

# route

Dispatch a request to the purpose that owns it. The shell carries this skill; the
goal is a fast, correct handoff — not doing the work here.

## Steps

1. **Read the map**: the workspace `CLAUDE.md` lists the visible purposes, their
   skills, tools, context (okf) and data (surreal) mounts.
2. **Match**: which purpose *decides* what this request needs? Prefer the deepest
   purpose that fully contains it (a leaf over its parent).
3. **Handoff**: name the purpose and its persona, state WHY in one line, and hand
   the request over with any context gathered.
4. **No fit**: say exactly that, list the closest candidates, and ask the human to
   choose. Never guess a destination for consequential work.

## Composite requests (spans several purposes)

A single input can carry work for several purposes — a meeting transcript that holds
a client update, a project decision AND a new-proposal lead. Don't pick one winner
and drop the rest, and don't do it all yourself: **decompose and orchestrate**.

1. **Decompose**: split the input into parts, each matched to its purpose (step 2
   per part). Show the human the split in one compact list before dispatching
   anything consequential.
2. **Dispatch**: the purpose personas are available as subagents (`.claude/agents/`).
   Send each part to its persona as a task with a self-contained briefing — the
   subagent starts with a clean context and knows nothing you don't tell it. Quote
   the relevant slice of the input (or point precisely at it); independent parts go
   out **in parallel**.
3. **Threads stay alive**: a dispatched agent that answers with a question is not a
   dead end — relay the question to the human and **continue the same agent** with
   the answer (its context is intact). Don't re-dispatch from scratch.
4. **Synthesize**: one coherent report back — what each purpose did/answered, what
   is pending on whom. You are the only one who sees all the parts; the human should
   not have to reassemble them.
5. **Journal the dispatch** (journal skill, origin `shell`): what came in, how it was
   split, who got what. The drain reads this to see how routing is really working.
