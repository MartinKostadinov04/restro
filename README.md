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

### The venue admin (`apps/web`)
Needs the database, its tables, the app role and a demo owner. With `pnpm db:local` running and `.env.local` copied from `.env.example`:

```
pnpm db:migrate && pnpm db:roles    # DATABASE_URL_OWNER and DATABASE_APP_PASSWORD from .env.local; set them in your shell first (the db scripts do not read .env files)
pnpm db:seed:dev                    # demo owner + organisation "Demo Club" + venue "Demo Club Sofia" (slug demo-club)
pnpm dev                            # http://localhost:3000 → sign in with DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD
```

- `pnpm db:seed:dev` is safe to repeat. It refuses to run unless `NODE_ENV` is `development` and the database is on this machine.
- The admin starts in Bulgarian; the user menu (bottom of the sidebar) switches the language (a cookie) and the light/dark theme.
- `http://localhost:3000/dev/fields` (development only, no sign-in) shows every field type as an editable row; saving there only changes the page, never the database.
- `apps/web` reads the repo-level `.env.local` too (`apps/web/next.config.ts`), so one file serves the scripts and the app. Sign-up is off: new people arrive by invitation, later.

Before a pull request: `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build`. The database tests run when `DATABASE_URL_OWNER` is set (CI sets it and then fails instead of skipping). `pnpm test:e2e` builds the web app and runs the Playwright tests against it (`pnpm --filter @restro/web exec playwright install chromium` once); it needs the migrated local database and seeds the demo owner itself.

## Scaffold conventions
- **Workspace packages export TypeScript source** (`"exports": { ".": "./src/index.ts" }`), so there is no build step for packages and changes show up at once. Next.js compiles them (`transpilePackages` in `apps/web/next.config.ts`), the worker bundles them (`noExternal` in `apps/worker/tsup.config.ts`), Vitest runs them as they are. A new package needs a `package.json` like its neighbours, a `tsconfig.json` extending `tsconfig.base.json`, and a `workspace:*` dependency from whoever uses it.
- **Code style** is set by `biome.json`: 2-space indent, single quotes, semicolons only where needed, trailing commas, 100 columns. Run `pnpm format` to fix; `pnpm lint` only checks.
- **Tests:** Vitest files end in `.test.ts(x)` and sit next to the code (or in `tests/`); Playwright specs end in `.spec.ts` and live in `apps/web/e2e/`. One Vitest project per package or app is found automatically from `vitest.config.ts`.
- **Import rules** live in `.dependency-cruiser.cjs`; `scripts/depcruise-rules.test.ts` proves each one fires. Changing a rule means changing that test.
- **Web app layout:** routes in `apps/web/app`, everything else in `apps/web/src` (`@/` alias): `components/ui` (shadcn, with our fixes), `fields` (the UI field-type registry), `server` (auth, tenant-scoped reads), `i18n`. Interface text lives in `apps/web/messages/{bg,en}.json`; a test fails if the two differ. Add shadcn components with `npx shadcn@4.21.0 add <name>` from `apps/web` (`pnpm dlx` fails on this PC), then repoint any `from "cn"` import to `@/lib/utils` and run `pnpm format`.
- **Versions** are pinned exactly (`save-exact` in `.npmrc`). Update them deliberately, not with `^`.
