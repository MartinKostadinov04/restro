---
name: revisit-decision
description: Find the context behind a Restro decision (a D-number) when the decision file alone is not clear - why it was taken, what was rejected, what was left open or out of scope, or whether a small point was decided at all. Reads the decision log of the grilling that made it, then the deliverables behind it. Use before acting on, questioning or reopening a decision whose reason you cannot see, and when Martin asks why something was decided.
---

# Revisit a decision

A D-file binds, but it is short. The grilling that made it keeps a **decision log** (`docs/agents/domain.md` → "Decision logs", D114): one row per decision, with why, status and where it is recorded. The research and opinions behind it are deliverables in `docs/deliverables/`. This skill reads them in that order, and stops as soon as the question is answered.

## Steps

1. **Find the decision in force.** Read `docs/decisions/D<n>.md`. If its status says it was superseded or refined, follow the chain to the newest file: that one binds.
2. **Find its log.**
   - The D-file's sources line names `…-decision-log.md`.
   - Otherwise search the logs for the number: `docs/deliverables/*-decision-log.md`.
   - No log: decisions made before 10-18 have none. Go to step 4.
3. **Read the rows on your topic,** not the whole log.
   - **Why** gives the reason.
   - **Status** says what was *not* decided: `later`, `on request`, `out` and `open` rows are as binding a "no" or "not yet" as a firm row is a "yes".
   - A row marked as replaced shows an alternative that was rejected.
   - A point with no row was not decided.
4. **Read further only if still unclear:**
   - the deliverables the row or the D-file cites, which are research, opinions and process maps (index `docs/deliverables.md`);
   - for the exact words Martin used, a grilling's question-and-answer record if one exists (e.g. `2026-10-18-bill-grilling-record.md`);
   - for older decisions, `docs/tracker.md` (search the D-number or its Q/P/T) and `docs/research/`.
5. **Answer** with what you found and where: the D-number, the log row (`<log> #<row>`) and the deliverable. If nothing explains it, say so: an unknown stays an unknown.

## Rules

- **The D-file binds; logs and deliverables only explain.** A log row never overrides a D-file. If they disagree, the newer D-file wins. Flag the disagreement in your report (`docs/agents/domain.md` → "Flag decision conflicts").
- **Never edit a closed log or a filed deliverable** (D114). A decision that needs to change is Martin's: propose it with a recommendation, and the lead records it as a new D-number.
- **A row marked `open` is a stop-and-ask** when your task depends on it (CLAUDE.md, "Stop and ask"). Name the ticket it points to.
- **Read only what the question needs.** The logs and deliverables are for looking things up, not for reading whole (Martin 10-11).
