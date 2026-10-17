# Ship

From ticket to merged code. Every code-changing flow ends here.

## 1. The ticket
A GitHub issue (`docs/agents/issue-tracker.md`): `to-tickets`' issue template, or `triage`'s agent brief for a bug or change, plus this block at the end:

```markdown
## Restro
- **Model:** Haiku | Sonnet | Opus or Fable (D58; Opus or Fable for apply(), resolver, snapshot, sync and deletion, RLS, money, the nine rules)
- **Codes it:** lead (only a nine-rule change, a migration or a guardrail) | agent session
- **Branch:** `<stage>/<slug>` from `<stage branch>`; pull request into `<stage branch>`
- **Read:** decisions D…, architecture sections …, Platform files … (`docs/platform-reference.md`)
- **Stop and ask if:** anything task-specific beyond CLAUDE.md's list
```

Testing, done-criteria and the report format come from CLAUDE.md; the ticket doesn't restate them. Label it `ready-for-agent` once it is complete.

## 2. Build
- **Agent session:** one per ticket, in its own worktree, within `docs/agents/lead.md`'s limits. Brief: "Implement <issue URL> with the `implement` skill (its `SKILL.md`: restro-flow §3); follow CLAUDE.md; report in its format." Two Restro rules override `implement`'s text, and the brief says so: CLAUDE.md's testing tiers replace its "full test suite once at the end", and when its `code-review` step is done the session fixes the findings itself and keeps the review output in its report. The session ends by opening a pull request into the stage branch with `pr`'s body.
- **Lead:** the same steps for the tickets it codes itself.

## 3. Review (the lead)
- Read the diff and the session's `code-review` output; a finding is a hypothesis until checked in the code.
- Built-in `code-review` on the pull request, run by the lead so the bugs are judged outside the session that wrote the code: `low` by default, `high` when the diff touches a core-rule area; none for a wording, visual or docs-only diff. Its confirmed findings are facts; check its plausible ones in the code.
- Built-in `security-review` when the diff touches sign-in, roles, RLS, tokens, inputs from outside or secrets.
- For a core-rule diff, name the one fact the change is safe because of and prove it by running code (a test, a script), not by reading.
- A finding goes back to the same session (SendMessage) or becomes a new ticket.

## 4. Merge
- CI runs on the pull request. When it is green, the lead merges the pull request into the stage branch and closes the issue with a comment naming the merge commit. A conflict is resolved on the task branch, its touched tests re-run, then CI again.
- A pull request from a stage branch into `main` gets `pr`'s body plus the plain-language summary for Martin: what changed, why, what he can see or test, and that he can run `/code-review ultra <PR>` (a billed cloud review only he can start) before merging. Merging into `main` is Martin's. Once he has merged it, offer him one codebase-health scan of that stage's code (`upkeep.md` → Codebase health).

## 5. Report to Martin
A few plain sentences: what is done, what he can try and where, what waits on him. Then `retro` if the build went sideways.
