> Retired for new work (10-16): tickets are GitHub issues in the format of `.claude/skills/restro-flow/ship.md`. Kept for the briefs already written.

# Brief: <short task name>

- **Model:** Sonnet 5.5 | Opus 5.5 (Opus for anything touching apply(), resolver, snapshot contract, barsy sync/deletion, RLS/tenancy, money, or the nine rules)
- **Branch:** `<stage>/<slug>` (work in your own worktree; never commit to `main`)
- **Read first:** `CLAUDE.md`, `docs/tracker.md` (decisions D1–D50), the doc sections listed below, the Platform files listed below

## Goal
One paragraph: what exists when this is done, and why.

## Done when
- [ ] Concrete, checkable outcomes
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass

## Context
- Doc sections: `docs/architecture/data-architecture.md` → <section names>
- Rules involved: <rule numbers from CLAUDE.md>
- Platform files to study (read-only, `C:\Platform`): <paths + line ranges> — see `docs/platform-reference.md`

## In scope
Exact packages/files to create or change.

## Interfaces to implement
Types, function signatures, table shapes, route paths.

## Tests that must exist
Unit / property / integration / contract / e2e — with the cases.

## Out of scope / never do
- Anything listed in CLAUDE.md "Never"
- <task-specific exclusions>

## Stop and ask (do not guess) if
- a rule or doc section is ambiguous or contradicts another
- you need a barsy call that is not in the official docs, or behaviour the docs don't state
- you want a dependency that is not already in the repo or named here
- you need a schema change beyond this brief
- a UX choice is not specified

## Report back (final message)
1. What changed (files, one line each)
2. What was ported from the Platform and what was changed while porting
3. Test results (commands + pass/fail)
4. Open questions, each with your recommendation
5. Anything you noticed that is out of scope but worth a follow-up
