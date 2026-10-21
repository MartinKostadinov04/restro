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
- **Menu functionality:** none | revises `docs/guides/menu-template-functionality.md` (the ticket adds, changes or removes something a guest can do in the menu; the same change updates the file)
- **Screen:** none | the screen plan below, and `docs/guides/operational-screens.md` goes on the Read line (the ticket adds or changes an operational screen, D107; a wording or visual tweak writes `none`)
```

**The screen plan** (D123) is the design of an operational screen, written before its code and judged against afterwards. The planning session writes it during the grilling, where the stories are, or, in a feature set, when the tickets are cut from the spec; never the implementer, whose inventing it is the gap it closes. Martin confirms the story list and any behaviour choice (an unspecified UX choice is a stop-and-ask); the lead decides the rest. About fifteen lines, as a section of the ticket:

```markdown
## Screen plan
- **Stories and taps:** each story the screen serves ("As a <persona> I want <x>, so that <y>"), with today's taps from `docs/guides/admin-map.md` where the story exists, and its target: from a documented comparable (a POS front end, a comparable admin) when one exists, else today's count or fewer, with the reason. A target is an acceptance criterion: the story's Playwright spec, or the behaviour audit, counts it.
- **Place:** where the screen sits on the admin map and how it is reached.
- **Pattern:** for each job on the screen, the pattern from `docs/guides/operational-screens.md` → Patterns; a job with no pattern there is a question to the lead.
- **Primary action:** the one.
- **States:** empty, loading, failed, the longest Bulgarian text, many items, a member whose role forbids the action, a POS venue where the control is read-only (D87–D92); a state that does not apply is written "n/a: <reason>".
- **Strings:** every new interface string, Bulgarian and English (`copy-rules.md`).
```

Testing, done-criteria and the report format come from CLAUDE.md; the ticket doesn't restate them. Label it `ready-for-agent` once it is complete.

## 2. Build
- **Agent session:** one per ticket, in its own worktree, within `docs/agents/lead.md`'s limits. Brief: "Implement <issue URL> with the `implement` skill (its `SKILL.md`: restro-flow §3); follow CLAUDE.md; report in its format." Two Restro rules override `implement`'s text, and the brief says so: CLAUDE.md's testing tiers replace its "full test suite once at the end", and when its `code-review` step is done the session fixes the findings itself and keeps the review output in its report. The session ends by opening a pull request into the stage branch with `pr`'s body.
- **Lead:** the same steps for the tickets it codes itself.

## 3. Review (the lead)
- Read the diff and the session's `code-review` output; a finding is a hypothesis until checked in the code.
- Built-in `code-review` on the pull request, run by the lead so the bugs are judged outside the session that wrote the code: `low` by default, `high` when the diff touches a core-rule area; none for a wording, visual or docs-only diff. Its confirmed findings are facts; check its plausible ones in the code.
- For an admin UI diff, two reads, and a finding is reported once, under the read that found it. **The code:** the lead audits the diff against `.claude/skills/template-review/references/web-interface-guidelines.pinned.md` with its `web-interface-guidelines.restro-overrides.md` (the overrides win) and `copy-rules.md`. **The screen:** on the pull request's branch, environment as `audit-behaviour.md` step 3, the lead opens each changed screen in the preview (`preview_start`, 390 px) and reads it as the owner, with `docs/guides/operational-screens.md` (Clean, the eleven wayfinding, screen-read and feedback answers, the Accessibility criteria, the Patterns) and the ticket's screen plan (its pattern, primary action, states and target taps, each tried). For a `Screen: none` diff, read only the changed element. Done when each changed screen has its eleven answers and its Accessibility verdicts, and each screen-plan line has a verdict.
- Built-in `security-review` when the diff touches sign-in, roles, RLS, tokens, inputs from outside or secrets.
- For a core-rule diff, name the one fact the change is safe because of and prove it by running code (a test, a script), not by reading.
- A finding goes back to the same session (SendMessage) or becomes a new ticket.

## 4. Merge
- CI runs on the pull request. When it is green, the lead merges the pull request into the stage branch and closes the issue with a comment naming the merge commit. A conflict is resolved on the task branch, its touched tests re-run, then CI again.
- A pull request from a stage branch into `main` gets `pr`'s body plus the plain-language summary for Martin: what changed, why, what he can see or test, and that he can run `/code-review ultra <PR>` (a billed cloud review only he can start) before merging. Merging into `main` is Martin's. Once he has merged it, offer him one codebase-health scan of that stage's code (`upkeep.md` → Codebase health).

## 5. Report to Martin
A few plain sentences: what is done, what he can try and where, what waits on him. For a ticket with a screen plan, list its stories with their target taps, so he tries those and says which felt long: his taps are the design loop's cheapest signal (D123). Then `retro` if the build went sideways.
