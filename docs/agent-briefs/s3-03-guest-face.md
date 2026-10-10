# Brief S3-03: the guest phone page (face `qr-phone`, `/m/<venue>`, `/t/<token>`, venue theme)

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01b is merged.
- **Read first:**
  - `CLAUDE.md` (rule 4: guest pages read only snapshots; faces never import db, barsy or apps);
  - `docs/architecture/data-architecture.md` → "The visualization shell", "The face contract", "Files on the CDN";
  - `docs/tracker.md` → D10, D42, D45, D46, D60, D61, D62 and the S3-01a note;
  - `packages/shell` (`buildViewModel`, context, `imageSlotsFor`, `generatePalette`, the view model types, `testing/` harness);
  - S3-01b's publish store, `/cdn` route and `writePublishFiles`;
  - `docs/platform-reference.md` → View engine (`C:\Platform\resources\js\Pages\Passport\Render.jsx` 152-341) and Theme (`Pages/Design/Index.jsx`). Read-only, reuse allowed.

## Contract-harness conventions (from S3-02, binding)
- **Render:** the face renders a view model to HTML. Test with `react-dom/server` `renderToStaticMarkup`.
- **Item placements:** each one carries `data-item="<nd_ id>"`.
- **Slots:** `data-slot="item.name"`, `item.price`, `item.allergens`, `item.state` (+ `data-state="<code>"`), `item.description`, `item.image`, `item.badges`, `item.portion`, `item.dietary`, `item.tags`, `item.modifiers`, `item.extra_fields`. Menu level: `menu.allergen_legend` / `menu.allergen_info`.
- **Test:** `expect((await runFaceContract(render, manifest)).failures).toEqual([])` over all fixtures.

## Do
1. **Face `packages/faces/qr-phone`:** manifest + React components that only draw the shell's view model.
   - **Manifest:** `qr` channel, scroll, `allergen_mode: 'inline_codes'` with a legend sheet, `no_image_layout: 'text_only'`, card image variant 4:3, description 3 lines + "more". Validated with `validateManifest`.
   - **Layout, top to bottom:**
     - menu title and intro;
     - table banner when a table is known ("Маса 12");
     - BG/EN switch;
     - sticky horizontal **section jump bar** (scrolls to and highlights the current section);
     - **tag filter chips** + dietary filter chips (from the view model's lists);
     - sections in order, each with **item cards**: photo (card variant, `srcset` from the variants, `loading="lazy"`, width and height set so nothing jumps), name (never truncated), description (3 lines + "more"), price or "from …", portion, tags and dietary chips, allergen codes (tap → legend sheet with full names), state ("Изчерпано" / "от 18:00" / "Попитайте сервитьора");
     - an allergen information footer.
   - **Styling:** theme tokens only, as CSS variables from the view model's semantic colours. No hard-coded colours (R13). Tap targets ≥ 44 px. Respects `prefers-reduced-motion`.
   - **Dependencies:** `react` / `react-dom` only, at the repo's versions. Imports only `@restro/shell` (and its types).
2. **Guest route `apps/web/app/m/[venue]/page.tsx`:** a static shell with a client component. It **never touches the database** (rule 4).
   - **Loading:** read `/cdn/v/<slug>.json` → `{venue_id, menu_id}` → `/cdn/m/<menu>/<venue>/current.json` → `/cdn/snap/<id>.json` → `live.json`.
   - **Refresh:** poll `current.json` every 30 s and `live.json` every 15 s while visible.
   - **Context:** language from `?lang=` (bg/en), then the browser, then the snapshot default; channel `qr`; `tableToken` from `?t=`; ordering off.
   - Build the view model with `buildViewModel` and render the face.
   - **States:** loading skeleton; a friendly error when the venue or menu is unknown or not yet published.
   - Read the Next.js 16.4 guides first (`apps/web/node_modules/next/dist/docs/`).
3. **Publish the slug index:** `writePublishFiles` (S3-01b) also writes `v/<venue slug>.json` `{venue_id, menu_id}` (cache 30 s). Venues already have a `slug`.
4. **`/t/[token]` route:** a tiny redirect with **no database**.
   - It reads `t/<token>.json` `{venue_slug, table_label}` from the publish store (local store directly, or the CDN when `PUBLISH_STORE=r2`) and redirects 302 to `/m/<slug>?t=<token>`.
   - Unknown token → a small "This table code is not active. Ask the staff." page (BG/EN) with no venue data.
   - S3-07 writes and removes these token files when tables get codes; here, add the reader, plus a test helper that writes one.
   - The page shows the table label from `t/<token>.json` in the banner.
5. **Venue theme** (one brand colour + logo, Platform Design port):
   - Settings tab → an "Appearance" card: brand colour (hex input + swatches), logo upload (asset store, image checks as in the item sheet), and a live preview of the semantic pairs from `generatePalette`.
   - Stored in the venue's settings (`venues.settings.theme = {brand, logo_asset_id}`) through a writer in core/apply.
   - The publisher passes `theme` = palette + font + radius + logo into the snapshot instead of `DEFAULT_THEME` when set.
6. **i18n:** guest strings live in the shell tables (BG/EN). Admin strings (Appearance card, token page) go in `messages/*.json`, added to the T44 review list.

## Tests
- **Face contract:** `runFaceContract` over every S3-02 fixture → no failures.
- **Component tests:** jump bar, filters (tags and dietary), legend sheet, the language switch, sold out from the overlay.
- **Route tests:**
  - `/t/<token>` redirects or shows the inactive page;
  - the `/m/<slug>` loader follows the index chain and handles a missing pointer.
- **Playwright on a phone viewport** (Pixel 7 / iPhone 13 emulation):
  - publish the e2e menu (through S3-01b's action/job or the writer + `writePublishFiles` in setup), then open `/m/demo-club` and check: sections in order, BG ↔ EN, a price, an allergen legend, a tag filter;
  - **network check:** every request the page makes is to `/cdn/*` or Next's own assets, and none returns a barsy id (scan the bodies for the fixture's external ids);
  - `/t/<token>` → the menu with the table banner;
  - **Screenshots** BG/EN, light/dark, saved to `.local/screenshots/s3/s3-03-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_03` on the running 54329 instance), and the Playwright spec passes.

## Never / scope
- **Scope:** `packages/faces/qr-phone/**`, `apps/web/app/m/**`, `apps/web/app/t/**`, the Settings tab's Appearance card + its server action, `packages/core/src/apply/*` (venue theme writer, publisher theme feed), the worker's `writePublishFiles` (slug index), and `messages/*.json`.
- **Rule 4:** the guest page must never call the database or a server action.
- **No new dependency** beyond `react` / `react-dom` in the face package.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`, with the Platform port table (Render.jsx, Design page).
