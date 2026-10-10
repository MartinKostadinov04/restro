# Brief S3-01b: publish store, `/cdn` route, publish jobs, photo variants

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01a is merged.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/architecture/data-architecture.md` → "Files on the CDN" and "Publish policy";
  - `docs/tracker.md` → D57, D59, D62;
  - S3-01a's code in `packages/core/src/snapshot/*` and `packages/core/src/apply/publish.ts` (`publishMenu`, `rollbackTo`, `buildLiveOverlay`, readers);
  - `packages/assets/src/*` (store interface, local/R2 implementations, config);
  - `apps/worker/src/jobs/*`, `apps/worker/src/sync/catalogue.ts` (where a pull ends), `apps/worker/src/sync/photos.ts`;
  - `packages/core/src/jobs.ts`;
  - `apps/web/src/server/jobs.ts`, `apps/web/src/server/assets/*`.

## From S3-01a (merged, binding)
- **Photo variants:** `publishMenu` takes an `assetVariants` hook. Feed it from the new `assets.variants` column (asset id → available widths). Until variants exist, snapshots carry no image for that asset.
- **Snapshot files:** write `snap/<id>.json` from the **stored body** (`loadSnapshot`). Postgres reorders keys inside jsonb; order lives in arrays and the hash is canonical, so never depend on key order.
- **Holds:** `approveHold` takes the held `sn_` id and fails `held_outdated` if the document changed. When a publish succeeds, mark older `held` rows of the same menu + venue as `rejected`, with `decided_by: system` and a `superseded` note, through a small writer in `apply/publish.ts`, so stale holds don't pile up.
- **Editions:** the resolver gets `['venue:<vn>', 'service:<YYYY-MM-DD>']` (core `serviceDate`, D45).
- **Theme:** `DEFAULT_THEME` until S3-03 adds venue theme settings.

## Goal
Published menus become files a guest page can read, served locally the way a CDN will serve them later. The worker publishes on its own after a sync (when the venue allows it) and on request. Every photo gets small webp variants for phones.

## Do
1. **Publish store** (in `@restro/assets`): `PublishStore { put(path, bytes, {contentType, cacheControl}); get(path) }`.
   - `LocalPublishStore`: folder `LOCAL_PUBLISH_DIR`, default `.local/cdn`; refuses path traversal.
   - `R2PublishStore`: S3 `PutObject` with `CacheControl`, into `R2_PUBLIC_BUCKET` (later; mocked in tests).
   - Chosen by `PUBLISH_STORE=local|r2`; unset means local outside production.
2. **Cache rules, in one place** (`publishCacheControl(path)`):
   - `snap/*` and `a/*`: `public, max-age=31536000, immutable`;
   - `m/<menu>/<venue>/current.json`: `public, max-age=30`;
   - `live.json`: `public, max-age=15`.
3. **Web route `apps/web/app/cdn/[...path]/route.ts`:**
   - serves the local publish store with those headers and the right content types (json, webp), only when `PUBLISH_STORE=local`;
   - 404 for anything missing;
   - **no session needed**: these files are public by design and contain nothing internal (S3-01a's guard).
   - Read the Next.js 16.4 route-handler guide first.
4. **Jobs** (names and Zod payloads in `packages/core/src/jobs.ts`; handlers in the worker):
   - **`publish-menu` `{tenantId, menuId, venueId, reason, actor, approveHold?}`:**
     - calls `publishMenu`;
     - on `published` (or rollback), runs **`writePublishFiles`**, which is idempotent: write `snap/<sn>.json` if missing, then `m/<menu>/<venue>/current.json` `{snapshot_id, version, hash}` from the DB pointer;
     - records a job run (status, version, held/refused reason).
     - **Auto publishes merge within 30 s:** sent with `startAfter: 30`, with a singleton key per menu + venue, and a queue policy that keeps one waiting job per key. Two syncs in 30 s give one publish.
   - **`publish-files` `{tenantId, menuId, venueId}`:** only `writePublishFiles`. Used after a rollback, and as a repair.
   - **`publish-live` `{tenantId, menuId, venueId}`:** `buildLiveOverlay` → `m/<menu>/<venue>/live.json`. S3-08 triggers it; no debounce, but a singleton key.
   - **After a sync:** at the end of a full pull or incremental that applied at least one op, send `publish-menu` (reason `auto_sync`) when the integration config says `publish_after_sync` (default **true**, matching the doc's publish policy; S3-04 adds the switch).
5. **Photo variants** (`sharp`, approved by Martin 10-10; exact version, worker only):
   - **Store access:** add `get(key)` to `AssetStore` (local + R2).
   - **Job `asset-variants` `{tenantId, assetId}`:**
     - read the original;
     - make webp `w320`, `w640` and `w1280` (never wider than the original; keep the aspect ratio; strip metadata);
     - put them to the publish store at `a/<as_id>/w<n>.webp`;
     - record them in a new `assets.variants` jsonb column (migration).
   - **Triggers:**
     - the worker after `asset-fetch` stores a new asset;
     - the web after an upload (`enqueueJob`);
     - a one-off backfill command `pnpm --filter @restro/worker variants:backfill` for assets without variants.
   - **The builder** (S3-01a's context `assets`) only gets assets whose variants exist. Others count as no image, so the face uses its no-image layout.
6. **Web:** a server action `publishNowAction(venueId)` (owner/admin) that enqueues `publish-menu` with reason `manual`, and `rollbackAction(venueId, snapshotId)`. S3-05 builds the UI on them; add only the actions and their tests.

## Tests
- **Unit:** local publish store (put/get, traversal refused); cache rules per path; `/cdn` route (headers, content type, 404, traversal).
- **Worker integration** (Postgres + local publish store in a temp folder):
  - publish writes the snapshot file and `current.json`; republishing unchanged writes nothing new;
  - two auto publishes within 30 s → one snapshot version;
  - rollback → `current.json` points back;
  - a held publish (V11) writes no files;
  - `publish_after_sync = false` → no publish job after a sync.
- **Variants:** a 2000×1500 PNG gives three webp files of the right widths; a 300 px image gives only `w320` at its own width; the backfill finds only assets without variants.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_01b` on the running 54329 instance).

## Allowed dependencies
`sharp` (exact, `apps/worker` only). Nothing else.

## Never / scope
- **Scope:** `packages/assets/**`, `packages/core/src/jobs.ts`, `apps/worker/**`, `apps/web/app/cdn/**`, `apps/web/src/server/*` (the two actions + job sends), `packages/db/**` (one migration), `.env.example`.
- **Guest page:** no guest page (S3-03).
- **Files:** never put an original photo or anything private in the publish store.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
