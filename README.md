# Restro

QR-to-phone menu and ordering for Bulgarian nightclubs running the barsy POS. A guest scans a table QR code, reads the menu in Bulgarian or English and (later) orders and pays from the phone; the order reaches barsy as if a waiter had typed it.

Status: Stage 1 — setting up the ground. See `docs/tracker.md` for decisions and open questions.

## Where things are
| Path | What |
|---|---|
| `docs/tracker.md` | Decisions, open questions, tasks (the working memory of the project) |
| `docs/architecture/` | Mirrors of the Menu Engine Data Architecture doc. The live doc wins: https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a |
| `docs/platform-reference.md` | What we port from the Synex Platform UI and what we fix |
| `docs/agent-briefs/` | Task briefs for coding agents |
| `docs/research/` | Market research (background) |
| `CLAUDE.md` | Rules every coding agent follows |

## Running it locally
Everything runs through `pnpm` (pinned by `packageManager`; pnpm also runs scripts on the Node version in `.npmrc`, so the system Node does not matter).

```
pnpm install
pnpm db:local        # Postgres 17 on localhost:54329, stays in the foreground; Ctrl+C stops it cleanly
pnpm dev             # web on http://localhost:3000 and the worker
```

Copy `.env.example` to `.env.local` when a task needs settings. The default `DATABASE_URL` already points at `pnpm db:local`. The database lives in `.local/pg` (ignored by git); `pnpm db:local:reset` deletes it, `pnpm db:local:stop` stops it from another terminal. `docker-compose.yml` is an optional alternative for people who prefer a container.

Before a pull request: `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build`. `pnpm test:e2e` runs the Playwright smoke test against a production build (`pnpm --filter @restro/web exec playwright install chromium` once).

## Scaffold conventions
- **Workspace packages export TypeScript source** (`"exports": { ".": "./src/index.ts" }`), so there is no build step for packages and changes show up at once. Next.js compiles them (`transpilePackages` in `apps/web/next.config.ts`), the worker bundles them (`noExternal` in `apps/worker/tsup.config.ts`), Vitest runs them as they are. A new package needs a `package.json` like its neighbours, a `tsconfig.json` extending `tsconfig.base.json`, and a `workspace:*` dependency from whoever uses it.
- **Code style** is set by `biome.json`: 2-space indent, single quotes, semicolons only where needed, trailing commas, 100 columns. Run `pnpm format` to fix; `pnpm lint` only checks.
- **Tests:** Vitest files end in `.test.ts(x)` and sit next to the code (or in `tests/`); Playwright specs end in `.spec.ts` and live in `apps/web/e2e/`. One Vitest project per package or app is found automatically from `vitest.config.ts`.
- **Import rules** live in `.dependency-cruiser.cjs`; `scripts/depcruise-rules.test.ts` proves each one fires. Changing a rule means changing that test.
- **Versions** are pinned exactly (`save-exact` in `.npmrc`). Update them deliberately, not with `^`.
