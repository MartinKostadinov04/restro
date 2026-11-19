# Lane 2 hand-over (keep current)

## Done
- Environment: `restro_lane2` dropped and recreated, migrated, roles, `db:seed:dev`, `db:seed:demo` (needed a local `STAFF_PIN_PEPPER`, generated into `.env.local`). `.env.local` also points `LOCAL_PUBLISH_DIR` at this worktree's `.local/cdn-lane2` and `PUBLIC_BASE_URL` at the lane host (the copied values pointed into the lead's checkout and port 3000). `.claude/launch.json` has a `lane2-web` entry, marked skip-worktree (not committed).
- Worker needs `.env.worker.local` (seal private key), copied from the lead's checkout; git ignores it.
- Models from 11-19 (brief `1ae48918`): no Fable; explorer Sonnet, everything else Opus. The first (Fable) explorer left nothing; a Sonnet explorer restarted the walk.
- Running: web 3120 (`preview_start lane2-web`), worker (`pnpm --filter @restro/worker dev`, health 8121), sim-pos 4720 (`club-biad`). Pane signed in as the demo club's owner.
- Code check (code-review high, Fable): rows C1–C10 in `findings.md`.
- Security check (security-review + audit-security.md, Fable): no row; summary in `findings.md`.

## In progress / next
- Explorer (Sonnet) done: S1-S13 in `findings.md` (commit 14abab7b).
- Reset done (fresh `restro_lane2`; venue `vn_2iSwka0DYi9ywNOYdvk1dP`, guest `/m/club-biad-dj3z4gypdbsb`); pane signed in again.
1. Reviewer (Opus, step 4) running: paste its verdicts, R rows and fix plan into `findings.md`.
2. Stop web/worker/sim (lead's rule: servers only during walk steps). Fix PRs into `sr/foundation` by bundle; per PR: code-review high + security-review (Opus), pr-review-toolkit:review-pr (Opus), template-review for `packages/faces`.
3. Re-check walker (Opus, fresh) on the PR branch, `<id>-after.jpg`, rows to `re-verified`; `READY #<n>`.
