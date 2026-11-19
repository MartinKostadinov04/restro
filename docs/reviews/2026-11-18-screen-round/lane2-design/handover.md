# Lane 2 hand-over (keep current)

## Done
- Environment: `restro_lane2` dropped and recreated, migrated, roles, `db:seed:dev`, `db:seed:demo` (needed a local `STAFF_PIN_PEPPER`, generated into `.env.local`). `.env.local` also points `LOCAL_PUBLISH_DIR` at this worktree's `.local/cdn-lane2` and `PUBLIC_BASE_URL` at the lane host (the copied values pointed into the lead's checkout and port 3000). `.claude/launch.json` has a `lane2-web` entry, marked skip-worktree (not committed).
- Worker needs `.env.worker.local` (seal private key), copied from the lead's checkout; git ignores it.
- Models from 11-19 (brief `1ae48918`): no Fable; explorer Sonnet, everything else Opus. The first (Fable) explorer left nothing; a Sonnet explorer restarted the walk.
- Running: web 3120 (`preview_start lane2-web`), worker (`pnpm --filter @restro/worker dev`, health 8121), sim-pos 4720 (`club-biad`). Pane signed in as the demo club's owner.
- Code check (code-review high, Fable): rows C1–C10 in `findings.md`.
- Security check (security-review + audit-security.md, Fable): no row; summary in `findings.md`.

## In progress / next
1. Explorer (Sonnet, screen-review step 2): rows S<n> to append to `findings.md`.
2. Reset `restro_lane2` (drop, create, migrate, roles, seed:dev, seed:demo), sign in again, then the reviewer (Opus, step 4) with only the ledger path and the commit.
3. Fix PRs into `sr/foundation`; three reviews per PR; re-check by a fresh Fable; `READY #<n>`.
