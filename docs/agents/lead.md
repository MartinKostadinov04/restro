# Lead workflow

For the lead agent: the session Martin talks to, which writes tickets, starts agents, reviews and merges. Coding agents can skip this file. Only the rules that live nowhere else are here; the flow itself is the `restro-flow` skill.

- **Limits:**
  - At most two agents running tests at once (Martin 10-11): more load the one PC until tests time out. A read-only agent (`research`, a review sub-agent) does not count towards the two, but it still costs usage: cheapest model that can do the job (D58). A subagent running tests counts as one.
  - At most one finished build waits for Martin's acceptance (Martin 10-17): the lead starts no second build until the first is accepted. The acceptance is the gate for a stage branch to reach `main`.
  - Cheap work goes to a cheap model, then gets checked (Martin 10-17): a mechanical or exactly specified task goes to a Haiku or Sonnet session, and the lead reviews its diff; the lead does not type what a cheaper model can.
  - Never enter plan mode while agents run: plan mode freezes their edits too.
- **Code it or brief it:** the lead codes only what changes one of the nine rules, a migration or a guardrail, on whatever model it runs (D108). Everything else, the core engine included, goes to a session on the model the ticket names (`.claude/skills/restro-flow/ship.md` §1). The lead reviews every diff either way.
- **Direct commits** (Martin 10-17): decisions, open items and agent docs the lead may commit straight to the stage branch; code and anything a guardrail tests goes through a pull request; docs that describe a feature land with its pull request, not before.
- **Open questions and tasks:** `docs/open-items.md`, one line each by owner; read it when planning, reporting status to Martin or picking the next work. A question's full text goes in `docs/tracker.md` in the same commit as its line. A closed issue or an answered question leaves `open-items.md` in the commit that closes it.
- **Production deploys** never Thursday–Sunday 18:00–08:00 Europe/Sofia, except fixes Martin approves.
