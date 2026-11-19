# Lane 6 hand-over (navigation and feature bases)

Kept current by the lane 6 session so a restart reuses what exists.

## Done
- Environment: `.env.local` (lane values, local pepper and reveal token, not committed), `node_modules`, database `restro_lane6` recreated, migrated, roles, `db:seed:dev` and `db:seed:demo` (Club Biad Sofia, venue `vn_6EXddyw9FoZFWjYNrMja6p`; accounts owner/manager/host/waiter1/waiter2/bar `@club-biad.test`). Web `lane6-web` in `.claude/launch.json` (local, not committed) on `http://lane6.localhost:3160`; sim-pos on 4760; worker on 8161.
- Step 0 security check: `docs/reviews/2026-11-18-screen-round/lane6-navigation/step0-security.md`.
- "Before" screenshots: `before/`.

## Done since
- Step 0 code check: `docs/reviews/2026-11-18-screen-round/lane6-navigation/step0-code.md`.
- Step 1 plan written (Fable, before the model change), first critique `critique.md` (Fable), plan revised by a fresh Opus planner (Martin 11-19: no more Fable).
- Step 3: D154–D158 written as proposed and indexed.

- Second critique `critique-2.md` (Opus); answers L1–L10 in the plan.
- Step 4 build: PR #456 into `sr/foundation` (commit 783eda35).
- Step 5 reviews: code-review high (Opus) on #456, 3 fixed in 9509581f, 2 skipped to ticket 8 (#467); security-review (Opus): one medium (Better Auth's `/organization/set-active` over HTTP let a device switch organisation), fixed by disabling the path.
- Step 6: tickets 1–9 filed `needs-triage`: #460–#468.

## Next
pr-review-toolkit:review-pr (Opus) → persona walk with after screenshots in `after/` (start web, worker and sim-pos only for the walk, stop them after) → PR body with screenshots, ready (never merge) → rebase onto `origin/sr/foundation` → report.
