---
name: screen-review
description: Review Restro screens in a round (D146) - an explorer walks, spots and critiques them with Anthropic's design-critique, accessibility-review and ux-copy under Restro's overrides, then an independent reviewer on another model re-checks every finding and plans the fixes. For bugs, optimisations and UX simplifications on operational screens and guest pages. Run by the lead from restro-flow (Audit › Screens); agents read this file, it never fires by itself.
disable-model-invocation: true
---

# Screen review

A round finds what is wrong or awkward on a set of screens and ends in fixes Martin picked. Two independent passes (D146): an **explorer** walks, spots and critiques; a **reviewer** on a different model re-checks every finding, finds what the explorer missed, and plans the fixes. An AI critic alone misreads screens and gives generic advice; the second pass and the evidence rule are what make the list trustworthy.

The lead runs steps 1, 3, 5 and 6 and briefs the two passes with "read `.claude/skills/screen-review/SKILL.md` and do step 2 (or 4)". Nothing here restates a check: each is named where it lives.

**Who writes the ledger.** A subagent may not write report files, so each pass returns its rows as text in its final message (in `finding-format.md`'s layout, nothing trimmed) and the lead saves them to the ledger; screenshots the pass copies beside it are fine. A pass run as a session writes the ledger itself.

## 1. Scope (lead, on the plan card)

One area per round: a few operational screens from `docs/guides/admin-map.md`, or the guest pages of one or more Styles (menu, dish, bag, Call a waiter, Bill, Pay, Receipt; D130). Name the personas (`audit-behaviour.md` step 1), the commit, and the open issues already filed for the area. Martin approves the card (restro-flow §2).

## 2. Explore, spot, critique (the explorer: a Sonnet session or subagent)

Environment: `audit-behaviour.md` step 3, with the worker and the simulated POS running (table codes, `/t/<code>` and the service screens need both; the trial's explorer missed them all without). The lead signs the browser pane in before starting the pass; the pass never types a password. Read `references/finding-format.md`, then `references/design.restro-overrides.md`, then the three files in `references/anthropic-design/`; the overrides win.

1. **Explore:** walk every screen in scope as its persona, following every control once, at the viewports, languages and themes `audit-behaviour.md` step 4 sets.
2. **Spot bugs:** behaviour against the decision text, console errors, failed requests, and the environment rows of `audit-behaviour.md` step 4 (320 px, 200 % zoom, hover-only actions).
3. **Spot optimisations:** taps per story against the baseline (`audit-behaviour.md` step 4); from the browser on the dev server only request counts, the same request twice, and polling. Sizes and timings on a dev server mean nothing, so a speed row is at most Polish unless CI's production build shows it.
4. **Spot simplifications:** a step that could go, two patterns for one job (`operational-screens.md` → Patterns), a word the persona would not know (`GLOSSARY.md`).
5. **Critique:** design-critique, then accessibility-review, then ux-copy, each section through its row in the overrides, so each check runs once. On an operational screen also the eleven answers, the Clean rules and break-ui, as `audit-behaviour.md` step 4 says; on a guest page the lines of `template-review` step 4, read on the live page.

Write each finding as a `candidate` row with its evidence; no severity, no ranking. End with the *Works* and *Could not see* lists. Done when every screen in scope has its Works line and every control was followed once.

## 3. Reset (lead)

A fresh database for the reviewer (`audit-behaviour.md` step 3), so rows are reproduced from the seed, not from the explorer's writes. A reset ends the pane's sign-in and changes every id: sign in again, check that a staff screen opens, and give the reviewer the new addresses the seed prints (they are environment, not the explorer's reasoning). Start the reviewer with only the ledger path and the commit, never the explorer's report or reasoning.

## 4. Independent review and fix plan (the reviewer: an Opus subagent)

If the pane is signed out, stop and say so in your reply rather than judging staff screens from the code; the lead signs in again and resumes you.

1. **Walk blind first:** before reading the ledger, walk two or three screens of the scope and note what you find. Then read it.
2. **Reproduce every row** on its own viewport, theme and language. Set Verdict `confirmed` or `rejected` with the reason; rejected rows stay. Mark a bug you can see only on the dev server "dev-only?". Merge duplicates in the ledger and against open issues (route, selector and check).
3. **Add your own rows** from the blind walk, marked as yours.
4. **Classify** each confirmed row: Severity, Effort, Decision, Needs Martin's yes (`finding-format.md`). A fix that changes how a screen looks or works needs his yes (CLAUDE.md, stop and ask on an unspecified UX choice).
5. **Plan the fixes** in a *Fix plan* section of the ledger: bundles by area, each a ticket in `ship.md` §1's format (bugs through `bug.md`, the rest through `change.md`), a ticket that changes an operational screen with its screen plan, and every row that broke a rule with the test that keeps it fixed in its existing home (`e2e/touch-targets.spec.ts`, the design sweeps, the copy rules; D67). Polish rows go into one table for Martin to pick from, not into tickets.

You file nothing. Done when every row has a Verdict and every confirmed row a Fix or a place in the Polish table.

## 5. Martin picks (lead)

Confirm the Blocking rows yourself. Tell Martin, in plain words: the Blocking and Before-the-pilot bundles, the decisions they contradict, and the Polish table. File what he picks, and at once every bug that changes nothing he would see, with the `walkthrough` label (`docs/agents/triage-labels.md`); Polish goes into one table issue, as #349 did. Each row moves to `ticket`.

## 6. Fix and re-check

Tickets ship through `ship.md`. A session that did not write a fix re-walks its rows' Steps on the same viewport, saves `<id>-after.<ext>`, and moves the row to `re-verified`; only then does the issue close. Done when no row of the round sits between `ticket` and `re-verified` without an open issue.

## When

After a stage branch that changes screens merges, once before the pilot, and when Martin asks. The report names what each vendored skill found that Restro's own checks did not; a section that finds nothing new in three rounds goes to Upkeep for removal (D109's gate).
