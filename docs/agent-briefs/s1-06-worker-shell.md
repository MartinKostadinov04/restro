# Brief S1-06: worker shell (pg-boss, heartbeat, health)

- **Model:** Sonnet 5.5
- **Branch:** your worktree branch, based on `s1/ground` after S1-03 (db) is merged
- **Read first:** `CLAUDE.md`; `docs/architecture/stack.md` → "Background jobs", "Monitoring"; `packages/db` (S1-03: roles, `pgboss` schema grant, `worker_heartbeats` table, `withSystem`)

## Goal
The always-on worker process that every future job runs in: pg-boss 12 started safely against our database with the app role, a heartbeat job proving the queue works, a tiny HTTP health endpoint Railway can probe, structured logs, and clean shutdown.

## Done when
- [ ] `apps/worker` starts pg-boss 12 with `DATABASE_URL` (app role), schema `pgboss`, migrations on start; logs `worker started` with version and pg-boss state (pino, JSON in production, pretty in development)
- [ ] A recurring job `worker-heartbeat` (pg-boss schedule, every minute) upserts `restro.worker_heartbeats` (`worker_id` = `WORKER_ID` env or hostname, `last_beat_at`, `version` from package.json) through `@restro/db` `withSystem`
- [ ] `GET http://localhost:${WORKER_HEALTH_PORT:-8081}/health` (node:http, no framework) → `200 {"status":"ok","lastBeatAt":…,"pgboss":"started"}` while healthy; `503` with a reason when pg-boss is stopped or the last beat is older than 3 minutes
- [ ] SIGTERM/SIGINT: stop accepting work, `boss.stop({ graceful: true, timeout: 20000 })`, close the pool, exit 0; documented in code
- [ ] A small job-registration convention for later jobs: `apps/worker/src/jobs/<name>.ts` exporting `{ name, schedule?, handler, options }`, registered from one list; failed jobs go to a dead-letter queue `<name>.dead`
- [ ] Integration test (real Postgres via `pnpm db:local`, required in CI): boot the worker in-process against a fresh database, trigger the heartbeat handler, assert the row; health returns 200; shutdown leaves no open handles
- [ ] `.env.example` gains `WORKER_ID`, `WORKER_HEALTH_PORT`, `LOG_LEVEL`
- [ ] `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass

## Binding facts from S1-03 (db)
- `@restro/db`: `createPool(url)` (opaque handle), `withSystem(pool, fn)` for `worker_heartbeats`. Read the package before starting.
- pg-boss **must** be configured with `schema: 'pgboss', createSchema: false` — the owner migration creates the schema; `restro_app` has `USAGE, CREATE` on `pgboss` only and must never get database-level CREATE.
- Set `statement_timeout` and `idle_in_transaction_session_timeout` on the worker's connections and keep the pool small (≤ 5) so Supabase's session pooler limit is respected.
- Log `error.cause` (Postgres message/code), never the Drizzle error message (it contains query parameters).
- Also add two import rules in `.dependency-cruiser.cjs` with matching cases in `scripts/depcruise-rules.test.ts`: (a) nothing outside `packages/db` may deep-import `packages/db/src/**` (only the `@restro/db` and `@restro/db/write` entry points); (b) `packages/db/src` read-side files may not import `packages/db/src/write`. Remove the stale "path does not exist yet" comment.

## Local database
Docker does not work on this PC. Use `pnpm db:local` (localhost:54329). If port 54329 is already serving (another agent), reuse it with your own database (`restro_s1_06`); stop only an instance you started; leave nothing running.

## Allowed dependencies
`pg-boss` (12.x, exact), `pino`, `pino-pretty` (dev). Nothing else without asking.

## Out of scope / never do
- No barsy calls, no menu jobs, no Railway config, no Telegram/Sentry yet.
- Never use the owner role at runtime. Do not edit CLAUDE.md, the tracker or architecture docs. Nothing from CLAUDE.md "Never". Commit on your branch only (end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- pg-boss 12 needs privileges beyond `USAGE, CREATE` on schema `pgboss`
- pg-boss's schedule/cron semantics differ from what this brief assumes

## Report back
CLAUDE.md report format, plus the env variables the worker needs (names and meaning).
