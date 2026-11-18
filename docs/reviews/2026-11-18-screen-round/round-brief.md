# Screen round 2026-11-18: the brief every lane reads

Martin asked (11-18, before sleeping) for a full Audit › Screens round (D146) over the whole platform, in parallel lanes, and wants **everything done when he wakes up**. The lead (the session that started you) orchestrates; you are one lane, run as its own session on Opus. Read this file, then your lane's section in your session prompt.

## Martin's answers (binding for this round)

- **Models:** Fable explores, spots and critiques (screen-review step 2) and does every review in the lane (the code check, the security check, the critique of the navigation plan). Opus re-checks every finding blind and plans the fixes (step 4), writes all code, and runs the whole `/pr-review-toolkit:review-pr` on each pull request. You (Opus) code and orchestrate; spawn subagents with `model: "fable"` or `model: "opus"` as above.
- **Every skill Martin named runs for real (Martin, 11-18, second message):** "make sure to use all of the skillsets I mentioned". Each is invoked through the **Skill tool** by the subagent that does the job (never paraphrased from memory, never replaced by a stand-in):
  - **`screen-review`** (D146): the explorer and the reviewer each read `.claude/skills/screen-review/SKILL.md` and its `references/` (the three vendored Anthropic skills: design-critique, accessibility-review, ux-copy) and do their step. The skill is `disable-model-invocation`, so reading the file is how it runs.
  - **`code-review`** on the lane's existing code: a Fable subagent calls `Skill(code-review, args: "high <the lane's paths>")` (never max or ultra).
  - **`security-review`** on the lane's existing code: a Fable subagent calls `Skill(security-review)` with the lane's paths named as its target, and, because that skill is built around a diff, **also** runs `.claude/skills/restro-flow/audit-security.md`'s checklist over the same code. Both outputs feed the ledger.
  - **On every fix pull request:** a Fable subagent calls `Skill(code-review, args: "high <PR number>")` and `Skill(security-review)` on the PR branch; an Opus subagent calls `Skill(pr-review-toolkit:review-pr)` with the PR number (the whole review, all its agents). Fix what they confirm in the same PR.
  - **Evidence:** your final report has a *Skills run* table: skill, target (paths or PR), model, and the result in one line. A missing row means the round is not done.
- **Picks:** Martin will not be picking. Fix everything the Opus reviewer confirms: Blocking, Before the pilot **and** Polish, including fixes that change how a screen looks or works, unless the fix contradicts a decision in force (then it is an open question with your recommendation, not a fix). Stay inside D107 (shadcn, calm, one accent, readable at first sight; `docs/guides/operational-screens.md`) on operational screens, and inside the template flow (`.claude/skills/restro-flow/template.md`, `template-review`) for anything under `packages/faces`.

## The round, per lane

Follow `.claude/skills/screen-review/SKILL.md` (on `or/foundation`) steps 2 to 6, with these Restro-of-tonight specifics:

1. **Branch:** the round has its own stage branch, **`sr/foundation`**, cut from `or/foundation` at `14f3b946` (the lead's branch; Martin, 11-18: "you will do your own branch"). Your worktree may start from the wrong branch. First: `git fetch origin` then `git switch -c <your lane branch> origin/sr/foundation` (if you already branched from `or/foundation` at `14f3b946`, it is the same commit: just retarget). Every PR you open has base **`sr/foundation`**; CI runs the full gate on it (`**/foundation`). At the end the lead opens one PR from `sr/foundation` into `or/foundation` and runs every skill on it. Work only in your worktree. Never touch `E:\Restro` itself (the lead's checkout, with Martin's uncommitted files), never `C:\Platform`.
2. **Your environment** (one per lane, so lanes never collide):
   - **Database:** your own database `restro_lane<N>` on the Postgres already running on `localhost:54329` (started by the lead). **Never** run `pnpm db:local`, `db:local:stop` or `db:local:reset`: they would stop or wipe every lane. A "fresh database" (skill step 3) means: drop and recreate `restro_lane<N>` only, then `pnpm db:migrate`, `pnpm db:roles`, `pnpm db:seed:dev` (and `db:seed:demo` if your screens need the demo club).
   - **`.env.local`** in your worktree: copy `E:\Restro\.env.local` and change only: every `/restro` database name to `/restro_lane<N>`; `BETTER_AUTH_URL=http://lane<N>.localhost:31<N>0`; `WORKER_HEALTH_PORT=81<N>1` and `WORKER_REVEAL_URL=http://localhost:81<N>1`; any sim-pos port to `47<N>0` (read the sim-pos CLI for the flag; never invent one). Never commit it.
   - **Web:** `next dev -p 31<N>0`, opened at `http://lane<N>.localhost:31<N>0` (the hostname keeps each lane's sign-in cookie apart; ports alone don't). Add a launch entry in **your worktree's** `.claude/launch.json` (don't commit it) and use `preview_start`.
   - **Worker and simulated POS:** run both (`pnpm --filter @restro/worker dev`, `pnpm sim:serve --scenario club-biad` on your port), in the background. Without them table codes, `/t/<code>` and the service screens are unreachable.
   - **Signing in:** you may sign in on your own lane host with the seed's test accounts and the local test password from `.env.local` (a `.localhost` dev host). Never repeat a password in chat or a report.
3. **Explorer (Fable subagent):** step 2. It returns the ledger rows as text; you save them to `docs/reviews/2026-11-18-screen-round/lane<N>-<slug>/findings.md` in your branch.
4. **Code check + security check (two Fable subagents)** in parallel with the explorer; their confirmed rows join the ledger as `code` / `security` rows.
5. **Reset**, then **reviewer (Opus subagent)**: step 4, blind, with only the ledger path and the commit.
6. **Fix:** you (Opus) code the fixes as one or more pull requests **into `sr/foundation`**, bundled by area (`ship.md`). Tests: only the files you change locally; the rest is CI (CLAUDE.md, Testing). `pnpm lint && pnpm typecheck && pnpm deps:check` must pass. Every row that broke a rule gets its test in its existing home.
7. **PR reviews:** the three reviews above, fixed in the same PR, CI green (`gh pr checks <n> --watch` in the background).
8. **Re-check:** a fresh Fable subagent that wrote none of it re-walks each fixed row on your lane's environment (PR branch), saves `<id>-after.png`, and moves the row to `re-verified`.
9. **Do not merge.** Never `gh pr merge`, never `--auto` (stage branches have no required checks: `--auto` merges at once). When a PR is ready, write in your turn's final message: `READY #<n>: <one line>`. The lead reads your diff and merges into `sr/foundation`. If the lead asks for changes, they arrive as a message.
10. **Rebase** onto the latest `origin/sr/foundation` before you say READY; other lanes are merging too.

## Shared limits

- CLAUDE.md applies in full: the nine rules, the never list, stop-and-ask (an open question goes in your report with a recommendation; you carry on with the rest, you do not stop the lane).
- **Decision numbers:** only lane 6 writes decisions (numbers 154 to 158). Other lanes cite, never create.
- **Open PR #451** (Not served refunds a paid line) is in flight: lane 3 leaves its code alone and files overlaps as notes.
- **Issues:** findings that you will not fix tonight are filed as issues with the `walkthrough` label (`docs/agents/triage-labels.md`), linked from the ledger.
- **Your final report** (CLAUDE.md format): the READY PRs, the *Skills run* table, the ledger path, the rows by status, what each vendored skill found that Restro's checks did not (D146), open questions with recommendations. End your session's work only when every confirmed row is `re-verified`, or filed with the reason.
