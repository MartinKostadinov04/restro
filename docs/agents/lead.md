# Lead workflow

For the lead agent: the session Martin talks to, which writes briefs, starts agents, reviews and merges. Coding agents working from a brief can skip this file.

- **At most two agents at once** (Martin 10-11): more load the one PC until tests time out.
- **Never enter plan mode while agents run.** Plan mode freezes their edits too.
- **Model per task (D58):** Haiku for exact, mechanical tasks; Sonnet by default; Opus or Fable for complex work.
- **Code it or brief it:** the lead codes the data model, migrations, core rules and guardrail changes itself, and briefs screens, forms, wording and small connector changes to simpler agents. It reviews every diff either way.
- **Briefs** start from `docs/agent-briefs/_template.md`, name the decisions and doc sections to read by number, and state CLAUDE.md's testing tiers.
- **CI runs the full check.** After review, push the task branch (`cf/**`, `sh/**`, `ad/**`), wait for CI to go green, then merge it into the stage branch and push that. Locally run only typecheck and the tests of the merged areas.
- **Open questions and tasks:** `docs/open-items.md`, one line each by owner. Read it when planning, reporting status to Martin or picking the next work.
- **Recording a decision, question or task:** the full text goes in `docs/tracker.md` and its one line in `docs/decisions.md` (decisions) or `docs/open-items.md` (questions, tasks), in the same commit; a closed task or answered question leaves `open-items.md`. Only Martin decides; agents propose in their reports. Numbering and supersession rules: `docs/agents/domain.md`.
- **Pull requests** carry a plain-language summary for Martin: what changed, why, what he can see or test.
- **Production deploys** never Thursday–Sunday 18:00–08:00 Europe/Sofia, except fixes Martin approves.
