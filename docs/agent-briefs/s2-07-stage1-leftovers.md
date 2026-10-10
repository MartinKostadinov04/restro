# Brief S2-07: Stage 1 leftovers

- **Model:** Sonnet 5.5 · **Branch:** your worktree branch from `s2/composer`
- **Read first:** `CLAUDE.md`; `docs/tracker.md` → T46 and "Engineering notes for Stage 2" (worker notes); `packages/db/scripts/roles.ts`; `apps/worker` (config, tsup config)

## Do
1. **T46 — timeouts on the role.** The Supabase session pooler ignores startup `options` (verified on `restro-staging`: `statement_timeout` came back as 2min). Make `pnpm db:roles` set `ALTER ROLE restro_app SET statement_timeout = '30s'` and `SET idle_in_transaction_session_timeout = '60s'` (idempotent, included in the final-state check, covered by the existing roles tests). Keep the worker's URL startup params as a harmless second layer or remove them — say which.
2. **Worker dependencies.** Declare `pg`, `@types/pg`, `drizzle-orm` (same exact versions as `packages/db`) in `apps/worker/package.json`; remove the tsup `require` shim banner and any `createRequire` workaround if no longer needed; the built bundle must still start (`node dist/index.js` with a local DB) and `/health` return 200.
3. **Worker config with Zod** (`zod` 4.6.5, already in the repo): replace the hand-written env parsing; same variables, same error style (name the variable, never the value).
4. **Docs in the repo:** `.env.example` header no longer says the database secrets are unused; `README.md` mentions `pnpm db:migrate && pnpm db:roles` after `pnpm db:local`.

## Done when
`pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests running (`CI=true`, local Postgres via `pnpm db:local`; if 54329 is busy reuse it with your own database and stop only what you started).

## Never
Touch only `packages/db/scripts`, its tests, `apps/worker`, `.env.example`, `README.md`. No new dependencies beyond those named. Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push. Report as in `docs/agent-briefs/_template.md`.
