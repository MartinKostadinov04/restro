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

- pr-review-toolkit:review-pr (4 Opus agents): fixes in 2970b561 (local, push after CI read).
- CI on dbfddbfb: unit green; e2e still fails at 390 px only: each screen's root (`tables-tab`, `tonight`, `reservations-*`) is found twice, one in `<main>`, one outside it. `loading.tsx` dropped (it also made a deleted venue 200). Cause (trace DOM): the second copy is React's streamed `<div hidden id="S:3">`, orphaned because the sidebar's `isMobile` flipped in its context right after hydration, which makes React client-render the still-pending Suspense boundaries. Fixed by reading `isMobile` per component (`useSyncExternalStore`), not from the provider's context.

- d4479361 pushed: the 390 px duplicate fix (isMobile out of the sidebar context). CI on it was still running when the usage limit hit; read it with `gh pr checks 456`.
- Persona walk (Opus, Playwright from the scratchpad) stopped at the limit: 9 owner screenshots in `after/` (desktop: settings, studio, studio-en, venues, switcher, ordering-settings; phone: sidebar, tonight, venues). Waiter, door host and tablet are not walked yet, and no critique rows came back. Servers stopped, ports 3160, 8161 and 4760 closed.

- Walk finished (11-20): rows in `walk.md`. S1, S4, S8 and S10 are fixed in c43f97e6; the rest wait for Martin's pick. Rebased onto `origin/sr/foundation` 4fa0ae3a.

## Next
CI green on the rebased branch → mark #456 ready (never merge) → report `READY #456`.
