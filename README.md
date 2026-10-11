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
pnpm db:local                       # Postgres 17 on localhost:54329, stays in the foreground; Ctrl+C stops it cleanly
pnpm db:migrate && pnpm db:roles    # in a second terminal: create the tables, then the app role (see below)
pnpm dev                            # web on http://localhost:3000 and the worker
```

Copy `.env.example` to `.env.local` when a task needs settings. The default `DATABASE_URL` already points at `pnpm db:local`. The database lives in `.local/pg` (ignored by git); `pnpm db:local:reset` deletes it, `pnpm db:local:stop` stops it from another terminal. `docker-compose.yml` is an optional alternative for people who prefer a container.

`pnpm db:migrate` creates the tables and `pnpm db:roles` creates the login role `restro_app` that the web app and the worker connect as. It gives that role exactly the privileges listed in `packages/db/src/table-access.ts` and, as session defaults, a 30 s `statement_timeout` and a 60 s `idle_in_transaction_session_timeout`. Run both once on a fresh database and again after every new migration (both are safe to repeat). Neither script reads `.env` files: export `DATABASE_URL_OWNER` and `DATABASE_APP_PASSWORD` (the values in `.env.example`) in your shell first. Until both scripts have run, the app and the worker have no role to connect as.

### The venue admin (`apps/web`)
Needs the database, its tables, the app role and a demo owner. With `pnpm db:local` running and `.env.local` copied from `.env.example`:

```
pnpm db:migrate && pnpm db:roles    # DATABASE_URL_OWNER and DATABASE_APP_PASSWORD from .env.local; set them in your shell first (the db scripts do not read .env files)
pnpm db:seed:dev                    # demo owner + organisation "Demo Club" + venue "Demo Club Sofia" (slug demo-club, with its own random public code: the guest address is printed) + its demo menu
pnpm dev                            # http://localhost:3000 → sign in with DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD
```

- `pnpm db:seed:dev` is safe to repeat. It refuses to run unless `NODE_ENV` is `development` and the database is on this machine.
- The demo menu (Composer tab) is made through `apply()` like a barsy pull, with made-up ids: four sections (Коктейли, Бира, Безалкохолни, Храна), 20 items in them (one hidden by barsy, one with a description written here) and two in Unsorted (one made here). Running the seed again never undoes what you moved in the composer.
- The admin starts in Bulgarian; the user menu (bottom of the sidebar) switches the language (a cookie) and the light/dark theme.
- `http://localhost:3000/dev/fields` (development only, no sign-in) shows every field type as an editable row; saving there only changes the page, never the database.
- `http://localhost:3000/dev/item-sheet` (development only, sign in first) opens the item sheet (Details, Translations, Media, History) for the items of the first venue, without the composer. Unlike `/dev/fields`, saves there are real: they go through `apply()`. Photos go to `.local/assets` (`ASSET_STORE=local`); staging and production use the private R2 bucket (`ASSET_STORE=r2`, see `.env.example`).
- The Playwright test of the item sheet runs on a `next dev` server beside the production build (the harness does not exist in a build); `E2E_PORT` moves both servers off 3100/3101. It seeds its item with `apps/web/scripts/seed-item-sheet.ts`.
- `apps/web` reads the repo-level `.env.local` too (`apps/web/next.config.ts`), so one file serves the scripts and the app. Sign-up is off: new people arrive by invitation, later.

Before a pull request: `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build`. The database tests run when `DATABASE_URL_OWNER` is set (CI sets it and then fails instead of skipping). `pnpm test:e2e` builds the web app and runs the Playwright tests against it (`pnpm --filter @restro/web exec playwright install chromium` once); it needs the migrated local database and seeds the demo owner itself.

## The worker
`apps/worker` is the always-on process every background job runs in: pg-boss 12 on our own Postgres, started as the app role `restro_app`. On start it checks the database role (it refuses a superuser or the table owner), lets pg-boss install its tables in schema `pgboss` (the migration owner creates the schema; the app role may only use and create in it), registers the jobs, and serves `GET /health`. Besides the heartbeat job `worker-heartbeat` (every minute it upserts this process's row in `restro.worker_heartbeats`), it runs the barsy sync jobs: the connection check (`barsy-connect`), the full and incremental menu pulls (`barsy-full-pull`, `barsy-incremental`) and the photo fetch (`asset-fetch`). The sync jobs register only when the worker holds both sealing keys.

Run it against the local database (once: `pnpm db:local` in one terminal, then `pnpm db:migrate && pnpm db:roles` with the owner variables from `.env.example` exported; outside its `dev` script the worker never reads `.env` files itself):

```
export DATABASE_URL=postgres://restro_app:local-only-not-a-secret@localhost:54329/restro   # PowerShell: $env:DATABASE_URL='...'
pnpm --filter @restro/worker dev        # watch mode; `start` runs the built bundle
curl http://localhost:8081/health
```

The worker's `dev` script loads the root `.env.local` and then `.env.worker.local` (worker-only, holds `SEAL_PRIVATE_KEY`).

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | `restro_app` connection string. The role carries a 30 s `statement_timeout` and a 60 s `idle_in_transaction_session_timeout` (set by `pnpm db:roles`, so they also hold behind Supabase's session pooler); the worker keeps five connections at most | required |
| `WORKER_ID` | Name of this process in `worker_heartbeats` | the host name |
| `WORKER_HEALTH_PORT` | Port of `GET /health` | `8081` |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` | `info` |
| `NODE_ENV` | `production` writes JSON logs (one object per line); anything else, readable lines | unset |
| `BARSY_ENV` | `development`, `test`, `staging` or `production`. The host rules below depend on it | `development` |
| `BARSY_ALLOWED_HOST_SUFFIXES` | Comma-separated. An integration's barsy host must end with one of them (each starts with a dot) | `.barsyonline.com` |
| `BARSY_PRODUCTION_HOSTS` | Comma-separated hosts of live venues. Every environment but `production` refuses them | none |
| `SEAL_PUBLIC_KEY` | Base64url DER (SPKI) X25519 public key, for the web app and the worker. Set it with `SEAL_PRIVATE_KEY`; `pnpm keys:seal` makes a pair | unset |
| `SEAL_PRIVATE_KEY` | Base64url DER (PKCS8) X25519 private key. Worker only: the web app never declares it | unset |
| `ASSET_STORE` | `local` or `r2`: where barsy photos go. The worker only writes there | `local` in development; an error in production when unset |
| `LOCAL_ASSET_DIR` | Folder of the `local` store. Used only with `ASSET_STORE=local` | `.local/assets` in the repository |
| `R2_ACCOUNT_ID` | Cloudflare account ID. Required with `ASSET_STORE=r2` | none |
| `R2_ACCESS_KEY_ID` | Access key of the R2 API token. Required with `ASSET_STORE=r2` | none |
| `R2_SECRET_ACCESS_KEY` | Secret of that R2 API token. Required with `ASSET_STORE=r2` | none |
| `R2_BUCKET` | Name of the private R2 bucket. Required with `ASSET_STORE=r2` | none |
| `R2_ENDPOINT` | S3 endpoint of the bucket. Set it for EU jurisdiction (`https://<id>.eu.r2.cloudflarestorage.com`); used only with `ASSET_STORE=r2` | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `PUBLISH_STORE` | `local` or `r2`: where published menus and photo variants go (the worker writes; the web app serves `local` at `/cdn/…`) | `local` in development; an error in production when unset |
| `LOCAL_PUBLISH_DIR` | Folder of the `local` publish store. Used only with `PUBLISH_STORE=local` | `.local/cdn` in the repository |
| `R2_PUBLIC_BUCKET` | Name of the public R2 bucket behind the CDN. Required with `PUBLISH_STORE=r2` (with the `R2_*` account settings above) | none |

`GET /health` answers `200 {"status":"ok","lastBeatAt":"…","pgboss":"started"}` while pg-boss is started and the last heartbeat is under three minutes old, and `503` with a `reason` otherwise (starting, stopping, no heartbeat yet, stale heartbeat). The answer comes from memory; a probe never touches the database. Run one worker replica for now: each heartbeat job is taken by one replica, so with two the other would look stale.

**Adding a job.** Create `apps/worker/src/jobs/<name>.ts` exporting `defineJob({ name, schedule?, handler, options })`, then add it to the list in `apps/worker/src/jobs/index.ts`. Everything else is done for it: the queue `<name>` and its dead-letter queue `<name>.dead` (where a job lands after its last retry), the option updates on every start, the schedule, and a safe error log. The convention is written out at the top of `apps/worker/src/jobs/types.ts`. Database access goes through the scoped helpers of `@restro/db`; handlers log errors as `log.error({ err }, '…')`, which drops query parameters and keeps Postgres's message and code.

**Stopping.** SIGTERM and SIGINT stop the worker cleanly: `/health` turns 503, pg-boss stops fetching and gives running jobs 20 seconds, both connection pools close, the process exits 0. A second signal, or a stop that takes longer than 30 seconds, exits 1. The platform's shutdown grace period must be longer than 20 seconds.

**Tests.** Unit tests run anywhere. `apps/worker/tests/worker.integration.test.ts` boots the real worker in the test process against a throw-away database it creates (and drops) through `DATABASE_URL_OWNER`, running `db:migrate` and `db:roles` on it first; it needs the same variables as the `packages/db` tests and is required in CI.

## Scaffold conventions
- **Workspace packages export TypeScript source** (`"exports": { ".": "./src/index.ts" }`), so there is no build step for packages and changes show up at once. Next.js compiles them (`transpilePackages` in `apps/web/next.config.ts`), the worker bundles them (`noExternal` in `apps/worker/tsup.config.ts`), Vitest runs them as they are. The npm packages the bundled code imports (`pg`, `drizzle-orm`, `zod`) are declared in the worker's own `package.json` too, at the same exact versions: that keeps them out of the bundle (tsup leaves a declared dependency external), and an undeclared CommonJS package such as `pg` would be bundled into the ES module and need a `require` shim. A new package needs a `package.json` like its neighbours, a `tsconfig.json` extending `tsconfig.base.json`, and a `workspace:*` dependency from whoever uses it.
- **Code style** is set by `biome.json`: 2-space indent, single quotes, semicolons only where needed, trailing commas, 100 columns. Run `pnpm format` to fix; `pnpm lint` only checks.
- **Tests:** Vitest files end in `.test.ts(x)` and sit next to the code (or in `tests/`); Playwright specs end in `.spec.ts` and live in `apps/web/e2e/`. One Vitest project per package or app is found automatically from `vitest.config.ts`.
- **Import rules** live in `.dependency-cruiser.cjs`; `scripts/depcruise-rules.test.ts` proves each one fires. Changing a rule means changing that test.
- **A face package** (`packages/faces/<id>`, a "template" in the gallery, D69) is laid out like `packages/faces/editorial-market`:
  - `src/manifest.ts` builds the manifest and runs `validateManifest` when the module loads, so an invalid face cannot even be imported. `src/index.ts` exports the face component, its stylesheet (`EDITORIAL_CSS`, one string) and the manifest.
  - **Subpath exports** in `package.json`: `.` (components and CSS), `./manifest` (the manifest and nothing else, so server code can read it without loading components) and, for a face that draws services, `./preview` (a demo host for the admin's preview; only the admin imports it). `qr-phone` has `./notices` instead of `./preview`.
  - **Allowed imports** (dependency-cruiser `faces-only-react-and-shell`): the face's own files, `react`, `react-dom` and `@restro/shell`. No `@restro/core`, no icon, UI or animation library, no other face, no Node built-in that does I/O; only test files may import `@restro/shell/testing`. Only a face's `preview/` folder may import `@restro/shell/money`. A face is a function of its view model: it fetches nothing and reads no clock. Dependencies in its `package.json` are `@restro/shell`, `react` and `react-dom`; its tests add Testing Library and `jsdom`.
  - **Tests** sit beside the code: a `contract.test.tsx` that calls `faceContractSuite` from `@restro/shell/testing` (manifest, every fixture, theme-only CSS, no `html`/`body`/`:root` rules, the feature slots) and runs the face with the host props set; a `manifest.test.ts`; a CSS test for its own rules; tests for the pure helpers (`model.ts`) and the screens. The web app's `src/faces/registry.test.ts` runs the same suite for every registered template, so none can be listed without passing. The designer guide (`docs/guides/shell-handoff/visualization-shell.md`) is the full contract, with the checklist for a new template.
- **Web app layout:** routes in `apps/web/app`, everything else in `apps/web/src` (`@/` alias): `components/ui` (shadcn, with our fixes), `fields` (the UI field-type registry), `faces` (the template registry: `manifests.ts` for server code, `registry.ts` with the loaders for client code), `design` (the Design tab), `guest` (the guest phone page), `server` (auth, tenant-scoped reads), `i18n`. Interface text lives in `apps/web/messages/{bg,en}.json`; a test fails if the two differ. Add shadcn components with `npx shadcn@4.21.0 add <name>` from `apps/web` (`pnpm dlx` fails on this PC), then repoint any `from "cn"` import to `@/lib/utils` and run `pnpm format`.
- **Versions** are pinned exactly (`save-exact` in `.npmrc`). Update them deliberately, not with `^`.
