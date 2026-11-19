# Lane 6 hand-over (navigation and feature bases)

Kept current by the lane 6 session so a restart reuses what exists.

## Done
- Environment: `.env.local` (lane values, local pepper and reveal token, not committed), `node_modules`, database `restro_lane6` recreated, migrated, roles, `db:seed:dev` and `db:seed:demo` (Club Biad Sofia, venue `vn_6EXddyw9FoZFWjYNrMja6p`; accounts owner/manager/host/waiter1/waiter2/bar `@club-biad.test`). Web `lane6-web` in `.claude/launch.json` (local, not committed) on `http://lane6.localhost:3160`; sim-pos on 4760; worker on 8161.
- Step 0 security check: `docs/reviews/2026-11-18-screen-round/lane6-navigation/step0-security.md`.
- "Before" screenshots: `before/`.

## In progress
- Step 0 code check: done, `docs/reviews/2026-11-18-screen-round/lane6-navigation/step0-code.md`.
- Step 1 plan written (Fable, before the model change), critique written (`critique.md`, Fable). Revision by a fresh Opus planner in progress (Martin 11-19: no more Fable).

## Next
Critique (independent Fable) → planner revises → D154–D158 (proposed) → build PR into `sr/foundation` → reviews (code-review high, security-review, pr-review-toolkit:review-pr) → persona walk with screenshots → tickets filed `needs-triage` → report.
