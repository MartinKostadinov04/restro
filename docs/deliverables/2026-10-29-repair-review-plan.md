# The repair-review of ordering and paying (`or/foundation`): plan

**Made by:** the lead session (Fable), 2026-10-29, after an independent Fable review of the first draft. **For:** Martin's request of 10-29: "a full review of the security, robustness, consistency and alignment with decisions", then the fixes. **Status:** approved by Martin 10-30 (all four decisions in §9); the freeze follows the last two part 2 pull requests.

The plan has four parts: what is reviewed and how (§1–§3), the agents with their models, prompts and rules (§4–§5), how findings travel and get judged (§6–§7), and the fixes (§8). §9 lists what Martin decides.

## 1. What is reviewed

The ordering stage branch `or/foundation` against `main`: 207 commits, about 70 merged pull requests, about 60,500 lines of hand-written code, 48,000 lines of tests and 11 migrations (0028–0038). Every pull request already had its lead's review and CI. What no per-PR review could see is the subject here:

1. **Cross-package state machines.** A sent order, a payment hold, a sitting and the night's close each live in `packages/core/src/service`, `apps/worker/src/jobs` (`payments.ts` alone is 2,071 lines), the Tonight screens and the guest API. Nobody has read a whole machine.
2. **Test quality, not quantity.** CI runs Playwright with two retries (`apps/web/playwright.config.ts:99`), so a test that passes on retry hides a race. Tests that assert on their own mocks never go red.
3. **Drift across 11 migrations:** grants, RLS on new tables, the role script (`packages/db/src/table-access.ts`), replay on empty and on seeded data.
4. **Semantics of the decisions** D110–D127 and rules 5–8. (Rules 1–3 and the layer boundaries are already pinned by dependency-cruiser, `write-targets.test.ts` and `rls-guard.test.ts`; re-reading them by hand would only make noise.)
5. **Tenancy, roles and inputs** across every entry point, attacked rather than read.
6. **Behaviour by persona** on the Demo Bar.

Not in scope: the menu designer (`st/foundation`, another lead; its own, lighter review when it is done), the parked Mistral connector, staging and production.

## 2. The pinned commit

The review runs against **one pinned commit** of `or/foundation`, so every agent reads the same code. No freeze is imposed (Martin 10-30): part 2 is finishing on its own, the menu designer builds on its own branch, and `docs/agents/lead.md` already keeps new feature work off a finished build until Martin accepts it. Fixes from the review come as `or/rr-*` pull requests.

Part 2 finished in the night of 10-29 (#114, #115, #116, #186 and the electronic receipt all merged; 28 pull requests in one day). Phase 0 starts on the tip of 10-30 morning; when the last two part 2 pull requests land (#235, the Demo Bar seed and the acceptance guides; #236, "Got it" on a failed refund), the pin moves to that tip before phase 1, and the two are read as a delta. Anything merged after that gets the same short delta read. Of #117's six sandbox checks, 1–3 are done; 4–6 need a staging address and a real phone, so they are Martin's step and stay outside the review.

A read-only worktree at the pinned commit (`.claude/worktrees/rr-pinned`) is shared by every reading agent; every agent that runs code gets its own worktree.

## 3. The sequence and the two test slots

`docs/agents/lead.md`: at most two agents running tests at once; readers don't count. `audit-robustness.md`: the robustness loops run with the machine otherwise quiet.

| Phase | Runs tests | What | Agents |
|---|---|---|---|
| **0 Pin and index** (half a day) | slots free | pin the commit; tell both leads; create the review folder; mechanical indices; static security scan; CI retry mining; migration replay; the state-machine audit begins | A1, A2, A3, A4, A6 |
| **1 Robustness** (about a day) | **both slots, nothing else** | the robustness runner writes and keeps the loops; readers work alongside | A5; A6, A10a–c, A11 read |
| **2 Attack and walk** (about a day) | one slot each | the security attack; the behaviour walk, then the flake re-runs | A7; A8 then A9 |
| **3 Quorum and tickets** (half a day) | none | every candidate judged (§7); tickets written | lead + verifiers |
| **4 Fixes** (one to three days) | one slot per fixer | fixes by package, normal ship review, kept loops re-run | fixers F1–F4 |
| **5 Acceptance** | — | Martin's hands-on (§8.4); the pull request into `main` | lead |

Five to seven days with the PC on, if the findings are of the expected size. Usage limits pause it; keep-awake keeps the night runs going.

## 4. The agents

Models follow D58 and D104: Fable for the state machines and the money/concurrency tie-breaks (heavy zone), Opus where code is run against the core engine or security, Sonnet for reading with a narrow brief and for the walk, Haiku for exactly specified mechanical work. "Session" = a desktop-app session in its own worktree (long, runs tests). "Subagent" = a read-only agent inside the lead's session.

| Id | Agent | Kind | Model, effort | Slot | Output file (in `docs/reviews/2026-10-29-repair-review/`) |
|---|---|---|---|---|---|
| A1 | Indexer | subagent | Haiku, medium | no | `index.md` |
| A2 | CI retry miner | subagent | Sonnet, medium | no | `flakes.md` (list only) |
| A3 | Static security | subagent | Sonnet, medium | no | `security-static.md` |
| A4 | Migrations and roles | session | Opus, high | yes (short, phase 0) | `migrations.md` |
| A5 | Robustness runner | session | Opus, high | both (phase 1) | `robustness.md` + kept tests |
| A6 | State machines | subagent | **Fable**, high | no | `state-machines.md` |
| A7 | Security attacker | session | Opus, high | one (phase 2) | `security.md` |
| A8 | Behaviour walker | session | Sonnet, medium | one (phase 2) | `behaviour.md` + screenshots |
| A9 | Flake runner | session | Sonnet, medium | one (phase 2, after A8) | `flakes.md` (verdicts) |
| A10a–c | Decision readers (3) | subagents | Sonnet, medium | no | `decisions-<cluster>.md` |
| A11 | Test-quality sampler | subagent | Sonnet, medium | no | `test-quality.md` |
| V1–V2 | Blinded verifiers (per finding) | subagents | Sonnet, low | no | a verdict row |
| V3 | Tie-break | subagent | Opus; Fable for money and concurrency | no | a verdict row |
| F1–F4 | Fixers (by package) | sessions | Opus for `core/service`, worker payments, `db`; Sonnet for web screens and settings | one each | pull requests into `or/foundation` |

**What each one does, and what it must not skip (the non-negotiables):**

- **A1 Indexer.** Four lists, by script, no judgement: (1) every entry point: the `'use server'` files, every exported server action, `/t/[token]`, `/api/*`, the guest API routes, every worker job with its pg-boss options (`singletonKey`, retry settings, expiry); (2) decision citations: `git grep -o 'D1[0-2][0-9]'` → file list per decision; (3) i18n: keys in `bg.json` not in `en.json` and the reverse, keys unused in code; (4) GLOSSARY terms misused in interface strings, and constants duplicated across packages. *Non-negotiable:* every list says the command that produced it, so it can be re-run.
- **A2 CI retry miner.** From the GitHub Actions logs of `or/foundation` (10-22 to the freeze): every Playwright spec that failed once and passed on retry, with run id and date. Read-only. *Non-negotiable:* no spec runs locally here; the list goes to A9.
- **A3 Static security.** The built-in `security-review` skill over the branch and `pnpm audit`. *Non-negotiables:* every hit is a candidate (§6), not a finding; the dependency advisories already listed in #202 (Next.js, zod, sharp, undici) are not reported again, only what #202 misses.
- **A4 Migrations and roles.** Replay 0028–0038 on an empty database and on a seeded one; diff the resulting grants and RLS policies against `packages/db/src/table-access.ts` and the `enable_tenant_rls` calls; list every new table or function and who may touch it (`close_payment_lines()` is revoked from PUBLIC: who holds it?); confirm `operators` and `provider_notices` are declared system tables if they have no tenant RLS. *Non-negotiable:* own database on 54329, never a remote one; nothing is fixed here, only found.
- **A5 Robustness runner.** `audit-robustness.md` as written, hot spots driven from A6's state diagrams and the ordering/paying list: many Sends at once on one table; a worker killed between each pair of steps of the payment route; pg-boss duplicates and retries per job; a payment hold meeting the night's close and the 07:00 edge; DST (25 Oct 2026); money rounding on odd prices and tips (rule 8); POS timeout, error and partial data on Send and on readings; the location pass and per-phone limits under bursts. For each: the invariant in one sentence, a red-capable loop (fast-check, concurrency on Postgres, MSW faults, pinned time), the verdict. *Non-negotiables:* a loop is kept only after it has gone red once by a deliberate mutation of the code or the invariant (then reverted); every kept loop lands as a test in its package (D67); a red loop is a finding with the test attached; no other agent runs tests during phase 1; CLAUDE.md's testing tiers, never the full suite locally.
- **A6 State machines.** Reconstruct from code, not from docs, the state diagrams of: a sent order, a payment (bag → hold → close → capture, with refusals and recovery), a sitting, the venue and table pauses, the night's close. For each transition: where it is written, which lock it takes, what happens if the process dies right after it, and whether D112, D115, D116, D117, D120, D122 and D127 (or/) say the same. *Non-negotiables:* diagrams first (delivered to A5 before phase 1), findings second; every mismatch quotes the decision text and names the file and line.
- **A7 Security attacker.** `audit-security.md` as written, with A1's entry-point list as the checklist: two seeded organisations, every action and read path called as organisation B against A's ids and as a member against owner and admin actions; the guest API with another table's code, an expired code and no code; fast-check fuzz on every Zod boundary; rule 3 on every guest API response and snapshot (no POS id, internal name, cost price); table-code and payment-id entropy; pino logs for personal data or secrets; Turnstile (including #117's note: one of Cloudflare's test secrets makes Turnstile pass every token, and nothing refuses a test secret outside dev and CI) and the Stripe restricted key's permissions; local abuse (floods on `/api/events` and the guest API), stopping at the first clear signal. *Non-negotiables:* localhost only, never staging, production, a live POS or Stripe live mode; a confirmed critical or high finding goes to the lead the moment it is confirmed; every gap gets the integration test that proves it, red.
- **A8 Behaviour walker.** `audit-behaviour.md` as written on the Demo Bar with the simulated POS and the simulated payment provider (sim-pay; the Stripe sandbox only for the card form): guest at 375 px in both languages, waiter and manager on Tonight at 390 px, owner in Settings; taps counted against the screen plans in #85, #86, #87 and #61. *Non-negotiables:* every story names its source (issue or D-number); a screenshot per step; the eleven wayfinding answers per operational screen; no fixes.
- **A9 Flake runner.** Each spec on A2's list, plus the two open flaky-test issues #42 (tables route-picker under the full vitest run) and #190 (touch-targets on the composer's Design subtab), alone, `retries: 0`, five repeats. *Non-negotiable:* a spec that fails even once is a finding (a race or a wrong test), never a "known slow test"; T75's two known slow tests are reported as such only if they pass alone.
- **A10a–c Decision readers.** Three clusters, each reader gets only its decisions' full text, the citing files from A1 and the spec issue: **(a) orders** D110, D111, D112, D115, D116, D117, D118, D122 ordering sections, rules 5, 6, 7; **(b) paying** D113, D125, D126, D127 (or/), D122 paying sections, rule 7 for payments, rule 8; **(c) guests and operations** D119, D120, D121, D122 Tonight and alerts sections, D123 (each built screen against its screen plan). *Non-negotiables:* the evidence contract (§6) on every row; a reader that cannot write the failure scenario writes an observation, not a finding; rules 1–3 are out of scope (guardrails already pin them).
- **A11 Test-quality sampler.** Thirty test files sampled from the hotspots (`core/service`, worker jobs, payments, `web/server`): for each, does any assertion test the mock rather than the code; could the test go red if the code were wrong (name the mutation); is the negative case tested. *Non-negotiable:* every verdict names the test and the line; the "never red" cases go to A5 as mutation candidates.

## 5. The prompt every agent is built from

Each agent's opening prompt follows one skeleton, so no agent invents its scope, its evidence standard or its report:

```
You are <role> in the repair-review of or/foundation (docs/deliverables/2026-10-29-repair-review-plan.md §4, agent <id>).
Pinned commit: <sha>. Work in <worktree path>. <Read-only: never edit, commit or run tests. | You may run tests; you hold test slot <n>; no other test runs are yours.>
Read first, and only these: CLAUDE.md; <flow file>; <decision files>; <index files from phase 0>; <spec issue>.
Your job: <the agent's paragraph from §4, verbatim>.
Non-negotiables: <the agent's list from §4, verbatim>; the nine rules; D67 (guardrails only tighten: a blocking guardrail is a stop-and-ask, never weakened); nothing touches staging, production, a live POS or Stripe live mode.
Evidence contract (every finding row): id RR-<agent>-<n> | severity critical/high/medium/low | file:line | the rule or decision text quoted | the concrete failure scenario ("if X while Y, then Z") | evidence: test path, reproduction command or screenshot | your confidence. No evidence, no row: write an observation instead.
Output: write only <your file> in docs/reviews/2026-10-29-repair-review/. Never write findings.md; the lead ledgers it.
Stop and ask (in your report, with your recommendation): CLAUDE.md's list; plus <agent-specific>.
Report: CLAUDE.md's report format, at most a page; findings count by severity; what you could not cover.
```

Model and effort are set on the session or subagent, not in the prompt. A session runs on the model and effort in §4; a fixer's ticket names its model in the Restro block (`ship.md` §1).

## 6. How findings travel

- **One ledger,** `docs/reviews/2026-10-29-repair-review/findings.md`, written **only by the lead**. Agents write their own file; the lead copies each candidate in as a row: `RR-<n> | from | area | severity | file:line | rule/decision | scenario | evidence | status`. Status moves `candidate → verifying → confirmed | dropped | observation → ticket #n → fixed <sha> → re-verified`. Two agents never edit one file, so nothing is lost to a conflicting write.
- **Agents talk to the lead, not to each other,** except two hand-offs the plan fixes in advance: A6's diagrams go to A5 before phase 1, and A2's list goes to A9. Both pass through their files; the lead tells the receiver when the file is ready (SendMessage for a session, the opening prompt for a subagent).
- **A critical or high candidate** from any agent reaches the lead immediately (a session: SendMessage; a subagent: it ends its turn with the finding first); the lead runs its quorum at once and tells Martin the moment it is confirmed, not at the end.
- **The two other leads** (Ordering, Part 2) are told before each fix merge (the standing heads-up rule) and when the fix wave is done. **The Design lead** (`st/foundation`, built on `or/foundation` and re-merged by them as it moves) is messaged before a fix merges that touches `packages/shell`, `packages/faces/*`, core's snapshot build or look/theme, or the composer's Design subtab (PR number first; they take the fix before building on it), and after any fix migration merges (they renumber theirs). A new decision from the review takes the next free number after the menu designer's four (132 or later, no file yet), agreed with the Ordering lead first.
- **Observations** (true but not a defect: a smell, a missing test, an awkward screen) go to the report's second half; Martin picks which become `change.md` tickets.

## 7. The quorum: is it a real issue?

Only this decision gets a quorum; everything else is one agent plus the lead. The evidence contract (§5) is the entry ticket: a row without file, rule and scenario is not judged, it is sent back.

- **Tier A, a finding with a red test** (from A5, A7, A9 or A4): the test is the proof. One Opus check reads the test and the claim and answers one question: does this test test this claim? Yes → confirmed. No → tier B.
- **Tier B, a finding without a test** (readers, A6, A11, A3, A8): two **blinded** Sonnet verifiers, each given only the file(s) and the one-sentence claim, never the finder's argument, each writing the failure scenario on its own. Two "real" → confirmed. Two "not real" → dropped, with both reasons kept in the ledger. Split → one tie-break: Opus; **Fable** when the finding is about money, concurrency, the write path or RLS (D104's heavy zone). A verifier that cannot make the scenario concrete in one pass votes "observation".
- **Severity** is set by the lead after confirmation: critical (money lost or taken twice, another organisation's data, a POS write outside the waiter's acts), high (a guest or staff path broken, a decision contradicted), medium, low.
- **Expected cost:** Sonnet on every row, Opus only on tier A checks and splits, Fable only on the heavy-zone splits.

## 8. The fixes

1. **Tickets.** Every confirmed finding becomes a GitHub issue with `ship.md`'s Restro block, label `ready-for-agent` plus a new label `repair-review`, grouped by package where findings share a cause. The ticket carries the red test (or the reproduction) and names the decision or rule; the fix is done when that test is green and the package's tests pass. Critical and high first.
2. **Fixers**, one session per package batch, one test slot each, at most two at once: F1 `packages/core/src/service` and `core/apply` (Opus), F2 `apps/worker` payments, recovery, night (Opus), F3 `packages/db` and migrations (Opus; a new migration takes 0044 upward: 0039–0042 landed with part 2's last day, and the menu designer keeps 0043 (agreed with the Design lead, nobody renumbers)), F4 `apps/web` screens, settings, server actions (Sonnet). Branches `or/rr-<package>`, pull requests into `or/foundation`, `ship.md` §3 review by the lead (Fable, the rung is sticky; built-in `code-review` at `high` for the core engine), `security-review` on anything touching roles, RLS, tokens or inputs.
3. **Re-verification.** The kept loops and the fixed packages' tests run in CI on each pull request; after the last merge the lead re-runs A7's tenancy checks for every closed hole (they are now tests, so this is one command) and A8 walks only the fixed screens. The ledger's rows move to `re-verified`.
4. **Then Martin.** The lead writes a 30–45 minute hands-on script: only what Martin can judge (feel, wording, what a club would miss), none of what the agents proved. Acceptance → the pull request into `main` with the plain-language summary (`ship.md` §4), and Martin may run `/code-review ultra` on it, pointed at the hotspots in §1, as an independent second opinion.

## 9. What Martin decided (10-30)

1. **The freeze:** first yes, then withdrawn the same morning: part 2 was finishing on its own and the designer builds elsewhere, so no rule is imposed on the leads; the review pins a commit and reads later merges as a delta (§2).
2. **Rule 1's text:** yes. CLAUDE.md said every change goes through `core.apply()`; D122 §9 added `applyService()` as the service data's write path. The line now names both, so the readers don't report it ten times.
3. **The decision-number collision** (`or/foundation` D124 and D127, how the guest page pays, against the menu designer's four decisions, which also started at 127 on the designer's branch): the three leads had already settled it on 10-29 the same way, before this plan reached Martin. The designer's four take the numbers 128 to 131 on `st/foundation` (they exist only there until that branch merges); ordering and paying number new decisions from 132; the Design lead cuts `st/foundation` from `or/foundation`'s tip and re-merges as it lands.
4. **Days of machine time:** yes; keep-awake on, the review runs through the nights, pausing at usage limits.
