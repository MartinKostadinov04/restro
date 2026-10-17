# Lead workflow

For the lead agent: the session Martin talks to, which writes briefs, starts agents, reviews and merges. Coding agents working from a brief can skip this file.

- **Every new request starts with the `restro-flow` skill** (`.claude/skills/restro-flow/`): classify it, show Martin the plan card, wait for his OK.
- **At most two agents running tests at once** (Martin 10-11): more load the one PC until tests time out. A read-only agent (`research`, a review sub-agent) does not count towards the two, but it still costs usage: cheapest model that can do the job (D58).
- **Cheap work goes to a cheap model, then gets checked** (Martin 10-17): a mechanical or exactly specified task goes to a Haiku or Sonnet session, and the lead reviews its diff; the lead does not type what a cheaper model can.
- **Never enter plan mode while agents run.** Plan mode freezes their edits too.
- **Model per task (D58):** Haiku for exact, mechanical tasks; Sonnet by default; Opus or Fable for complex work.
- **Model for planning (D104):** Sonnet by default; Fable in the heavy zone, announced when entered; a higher model's proposal when Martin doesn't know. The steps are in restro-flow §4.
- **Code it or brief it:** the lead codes only what changes one of the nine rules, a migration or a guardrail; everything else, core included, goes to a session on the model the ticket names (Opus for `apply()`, resolver, snapshot, sync, RLS, money). While the lead runs on Fable, what it would code goes to an Opus session (D104). The lead reviews every diff either way.
- **Tickets** are GitHub issues in the format of restro-flow's `ship.md`; `docs/agent-briefs/` holds the briefs written before 10-16.
- **A pull request per ticket into the stage branch.** The ticket session opens it when its work is done; CI runs on every pull request and on pushes to `main` and the stage branches (`<stage>/foundation`). After review and a green CI, the lead merges the pull request into the stage branch. Locally run only typecheck and the tests of the merged areas. Merge conflicts are resolved on the task branch and its touched tests re-run, never on the stage branch directly.
- **Open questions and tasks:** `docs/open-items.md`, one line each by owner. Read it when planning, reporting status to Martin or picking the next work.
- **Recording a decision:** its own file `docs/decisions/D<n>.md` plus its row in `docs/decisions.md`, same commit (`docs/agents/domain.md` has the format and the numbering rules). **A question or task:** full text in `docs/tracker.md`, one line in `docs/open-items.md`, same commit; a closed task or answered question leaves `open-items.md`. Only Martin decides; agents propose in their reports.
- **Production deploys** never Thursday–Sunday 18:00–08:00 Europe/Sofia, except fixes Martin approves.
