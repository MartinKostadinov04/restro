# Brief S3-09: small leftovers (Haiku)

- **Model:** Haiku. Four small, mechanical tasks. Do them exactly as written, in order, and commit after each. If a step does not match the code you find, **stop and report** instead of improvising.
- **Branch:** your worktree branch from `s3/guest`.
- **Read first:** `CLAUDE.md`, then only the files named in each step.

## Step 1: the worker writes a status *code*, the web translates it
**Today:** `apps/worker/src/sync/run.ts` exports `WRONG_CREDENTIALS = 'Wrong user or password'` and writes English text into `integrations.status_detail`. `apps/web/src/integration/status-card.tsx` compares against the same English string (line ~25) to translate it.

**Change:**
1. **Worker:** in `apps/worker/src/sync/run.ts`, replace the constant with `export const WRONG_CREDENTIALS = 'wrong_credentials'`. Keep the name so the importers keep working. Change `statusDetailFor()` to return codes:
   - `host_refused` → `'host_refused'`;
   - `credentials_unreadable` → `'credentials_unreadable'`;
   - anything else → `null`, as today.
   - Search the worker for other places that write `statusDetail` with English text and list them in your report; don't change them.
2. **Web:** in `apps/web/src/integration/status-card.tsx`, delete the English constant. Show the detail through next-intl:
   - if `status_detail` is one of `wrong_credentials`, `host_refused` or `credentials_unreadable`, show `t('integration.statusDetail.<code>')`;
   - otherwise show the stored text as it is (older rows).
3. **Messages:** add to `apps/web/messages/en.json` and `bg.json`, under `integration`, an object `statusDetail`:
   - **en:** `wrong_credentials`: "Wrong user or password.", `host_refused`: "This barsy address is not allowed.", `credentials_unreadable`: "The saved credentials cannot be read. Enter them again."
   - **bg:** `wrong_credentials`: "Грешен потребител или парола.", `host_refused`: "Този адрес на barsy не е разрешен.", `credentials_unreadable`: "Запазените данни за достъп не могат да бъдат прочетени. Въведете ги отново."
4. **Tests:** update the worker and web tests that assert the English text so they assert the code and the translated text instead. Assertions about anything else stay unchanged.

## Step 2: a structured "deletion check skipped" flag
**Today:** `apps/worker/src/sync/catalogue.ts` (lines ~445–449) pushes notes starting with `deletion check skipped:`, and `apps/web/src/integration/format.ts` `deletionCheckSkipped()` finds them with a regex.

**Change:**
1. **Type:** in `packages/db/src/schema.ts`, add the optional field `deletionCheckSkipped?: boolean` to the `JobRunDetails` type. A jsonb type change only; no migration.
2. **Core:** in `packages/core/src/apply/job-runs.ts`, `finishJobRun` takes an optional input `deletionCheckSkipped?: boolean` and writes it into `details` when given.
3. **Worker:** where the full pull adds either note, also pass `deletionCheckSkipped: true` through the run report to `finishJobRun`. Follow how `notes` travels in `apps/worker/src/sync/run.ts` (`RunReport`); add the field to `RunReport` the same way.
4. **Web:** `deletionCheckSkipped()` returns `run.details.deletionCheckSkipped === true` when `details` has that key. Otherwise it keeps today's regex, for older runs.
5. **Tests:** one test per layer (core writes it, worker passes it on a failed page, web reads both forms).

## Step 3: one allergen-key detection, in core
**Today:** the same rule lives twice:
- `packages/barsy/src/mapping/allergens.ts` (`ALLERGEN_DETAIL_NAMES`, used by `findAllergenKey`);
- `apps/web/src/server/integration/tree.ts` (`ALLERGEN_NAMES`, `detectAllergenOption`).

**Change:**
1. **Core:** add `packages/core/src/allergen-key.ts` with:
   - `export const ALLERGEN_DETAIL_NAMES: ReadonlySet<string> = new Set(['алергени', 'allergens'])`;
   - `export function isAllergenDetailName(name: string): boolean { return ALLERGEN_DETAIL_NAMES.has(name.trim().toLowerCase()) }`.
   - Export both from `packages/core/src/index.ts`, in the same style as the other exports there.
2. **barsy:** in `allergens.ts`, delete the local set and use `isAllergenDetailName(detail.detail_name)`.
3. **Web:** in `tree.ts`, delete the local set and use `isAllergenDetailName(option.name)`.
4. **Tests:** a small unit test for the new core file (Cyrillic, English, spaces and case). The existing tests of both callers must pass unchanged.

## Step 4: README worker env table
**Where:** `README.md`, section "## The worker", the variables table (it starts at the `| DATABASE_URL |` row).

**Change:**
- **Add one row each**, in the same style, for `BARSY_ENV`, `BARSY_ALLOWED_HOST_SUFFIXES`, `BARSY_PRODUCTION_HOSTS`, `SEAL_PUBLIC_KEY`, `SEAL_PRIVATE_KEY`, `ASSET_STORE`, `LOCAL_ASSET_DIR`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_ENDPOINT`. Copy each description and default from the comments in `.env.example` and from `apps/worker/src/config.ts`; never invent one.
- **Update the paragraph above it:** the worker now runs the barsy sync jobs, not only the heartbeat.
- **Add one sentence:** the worker's `dev` script loads the root `.env.local` and then `.env.worker.local` (worker-only, holds `SEAL_PRIVATE_KEY`).

## Done when
- `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass.
- DB tests (`CI=true` + the `DATABASE_*` values from `.env.example`) run on your own database `restro_s3_09` on the running 54329 instance. CLAUDE.md "Database tests" says how to create it; never stop that instance.
- If a formatting-only lint error appears, run `pnpm format`.

## Never / scope
- **Scope:** only the files named above, plus their tests. No other refactors.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit after each step (`Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`); never push.
- **Report:** short: per step, what changed and the test result, plus anything that didn't match.
