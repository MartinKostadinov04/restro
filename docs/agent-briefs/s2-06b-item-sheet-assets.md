# Brief S2-06b: composer — item sheet and photo storage

- **Model:** Sonnet 5.5 · **Branch:** your worktree branch from `s2/composer`
- **Read first:** `CLAUDE.md`; `docs/platform-reference.md` (Field rows, Media, History); `docs/tracker.md` → D24, D29, D42, D47, D55 and the Stage 2 engineering notes; `packages/core` (`apply/*`, `resolve/*` — `ResolvedField.provenance`, `locales`), `apps/web/src/fields/*` (registry, `FieldRow`, `FieldEditorSheet`, provenance badge, `isFieldEditable`). Platform (read-only, reuse allowed): `Components/FileBrowser.jsx` (upload UX), `Components/FieldTypes/image.jsx`, the Changelog timeline in `Pages/Passport/Internal/Partials/PassportEdit.jsx` 201-258.

## Goal
The **item sheet** the composer opens for one item (S2-06a renders `<ItemSheet itemId=… />` from `apps/web/src/composer/item-sheet.tsx`; you own that file — replace any stub): tabs **Details · Translations · Media · History**, every field shown through the registry with the resolver's provenance, edits saved through `apply()`, photos stored through a small asset store.

## Do
1. **Details tab:** one `FieldRow` per Item field of `VENUE_MENU_TEMPLATE` in template order (groups as dividers), value + badge from the resolver (`barsy` → "From barsy", `owned`, `overridden` with Revert, `stale` with "keep / take barsy's", `locked` → read-only "Change this in barsy" — price on a linked item). Save = server action → change set: builder-owned field → `manual` layer; barsy-owned overridable field (display name, portion) → `override` layer with `basis` = current barsy value; Revert / take barsy's → `clearField` on the override. Allergens edit as EU-14 chips; issues from the resolver listed at the top.
2. **Translations tab:** grid of the item's localized fields (name, description) × enabled locales (from the venue), barsy's value read-only where barsy holds that locale, our value editable where it doesn't (D24: per-locale `manual` writes, not overrides); missing cells highlighted; D24 review flag shown.
3. **Media tab:** the item's image (barsy photo once S2-03 fetches it; manual upload now). **Asset store** in `apps/web/src/server/assets/`: interface `AssetStore { put(key, bytes, contentType); getUrl(key, ttlSeconds) }` with two implementations — `LocalAssetStore` (dev, files under `E:\Restro\.local\assets`, served by an authenticated route handler) and `R2AssetStore` (S3-compatible, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, env `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`; presigned GET URLs, private bucket) chosen by env (`ASSET_STORE=local|r2`). Upload: image only (jpeg/png/webp, ≤ 10 MB, checked by magic bytes not just extension), checksum, width/height (read from the header; no `sharp` in the web app), write the `assets` row and the item's `image` field value `{asset_id, alt, focal}` through `core/apply` (add a small `createAsset` writer there with tests). Alt text per locale editable.
4. **History tab:** the item's `events` (field changes + structural events once S2-06a adds them) as a timeline: who, when, field, old → new (formatted via the registry), newest first, paged.

## Done when
`pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests (`CI=true`); unit tests for the asset store (local impl; R2 impl against a mocked S3 client), upload validation (magic bytes, size), override vs manual routing, Revert; Playwright: open an item → edit description (badge becomes "Owned here") → add an EN name in Translations → upload a photo (local store) → History shows the changes; price row is locked. Screenshots to `E:\Restro\.local\screenshots\s2\`.

## Allowed dependencies
`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (exact, same minor). Nothing else without asking.

## Never / scope
Do not build the tree/drag-and-drop (S2-06a) or sync/Integration (S2-03/S2-05). Never put an asset URL in a field value (asset id only). Do not read `E:\Restro\.env.local`; the R2 implementation must work without real keys in tests. Local DB: `pnpm db:local` (port 54329; if busy, reuse with your own database `restro_s2_06b`, stop only yours, leave nothing running). Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push. Report as in `docs/agent-briefs/_template.md` incl. the Platform port table.
