# Designer audit, B3: migrations 0045, 0046, 0047

**Who:** B3, the data and migrations agent, in the worktree `da-data` with the database `restro_da_data` (plus `restro_da_data_mess` and `restro_da_data_nobypass`, which I created) on localhost:54329.
**Pin:** `7dccd3a4` (st/foundation). The base is `origin/or/foundation`, which ends at 0044.
**Evidence:** the local branch `da/B3-tests` at `44bee87c`. It is never pushed.

**What I covered:**
1. 0045 on messy old data. I seeded 34 venues: 10 shapes the old app could write and 24 hand-edited ones. For each I compared or/foundation's own read and publish code with the wave's.
2. 0000-0047 under a migration owner with no superuser and no BYPASSRLS.
3. The first save of a venue that was migrated and never saved.
4. Old snapshots (qr-phone and editorial-market, with no design block) on today's guest page.
5. Deploy order: old code running against the migrated database, and reverse migrations.
6. Every reader of `events`, and the purges.
7. Grants and the policy on `design_styles` after `db:roles`.

**Deploy order (from the journal):**

| Order | Migration | Journal `when` |
|---|---|---|
| idx 45 | `0045_design_record` | 1793354960000 |
| idx 46 | `0046_drop_menu_settings` | 1793388616345 |
| idx 47 | `0047_design_styles` | 1793482653237 |

All three are later than or/foundation's 0044 (1793354900000). Drizzle applies them in this order, in one transaction. There are no reverse migrations: `migrations-reverse/` holds only `0014_till_role.down.sql`.

## Findings

| Id | Severity | Where (pin) | Rule | Failure scenario | Evidence | Confidence |
|---|---|---|---|---|---|---|
| DA-B3-1 | high | `packages/db/migrations/0046_drop_menu_settings.sql:3` (dropped in the same release, and the same transaction, as 0045 adds `design`) | data-architecture.md:725 "a new field ships in the reader one deploy before the publisher writes it" | If the migrations run before the old web app and worker are replaced (supabase-setup.md:110, "Railway's pre-deploy step"), or the code is rolled back after the deploy, then or/foundation's code meets a `menus` table with no `settings`. Its drizzle `select()`, `insert()` and `.returning()` with no arguments name every column, so they fail with `column "settings" does not exist`. What fails: every publish (`publish.ts:468`), the worker's auto-publish after a sync, `loadDraft`, `listMenus` and the composer's menu lists, menu create, rename, move, delete and restore (`menus.ts:128/256/325`), and venue provisioning (`provision.ts:455/480`). Any old `setVenueTheme` or `setVenuePresentation` writes in that window are lost. 0045 throws away `theme`, `presentation`, exact radius, shadow and preset, and 0046 drops the column, so a code rollback cannot restore service. | `packages/db/da-audit/old-menus-query.ts` runs or/foundation's schema queries against a database migrated to 0047: 5 FAIL, and only `purge.ts:427`'s narrow select passes. | 0.85 |
| DA-B3-2 | high (medium if decision 129 is read as covering the migration only) | `apps/web/src/design/design-draft.ts:101` (`designOf` never writes `brand`), `:116-125` (`keyOfDraft`: "a look saved the old way (one brand colour) opens as its three colours and counts as nothing changed"), `apps/web/src/design/design-page.tsx:231,261` | decision 129: "each saved design gets the value that draws what it draws today" | A venue whose old theme had only a brand colour (the v1 look) is migrated faithfully and still draws the same. When the owner opens Design, the preview shows the three-tint look, which guests don't have, and the page opens as not dirty. The first save of any other change rewrites the look as three colours, and every role changes. Light screen: surface #ffffff→#d5e2f9, text #020917→#242932, muted #0d358c→#5d636d, accent #1558ea→#2563eb. or/foundation guarded against this: `design-panel.tsx:113` used `isBrandOnlyLook` to open such a look as an unsaved change. That function (`look-state.ts:158`) is now used only by its own test. | `apps/web/src/da-b3/migration-0045.test.ts`: the cases v1brand, v1brandLogo, brandOverride and upperBrand give `firstSaveChangesRecord: true`, roles changed. | 0.8 |
| DA-B3-3 | medium | `packages/db/migrations/0045_design_record.sql:76,108` (carries `overrides` when it is any JSON object, without checking its contents) | ticket #170 acceptance "the guest page draws as before"; `record.ts:159-162` (the publisher refuses an invalid record) | If a venue's `theme.overrides` is an object with junk inside (a scheme given as a string, a bad hex value, an unknown scheme or role, a nested object), 0045 writes a design record the strict schema refuses. `hasInvalidDesign` then makes every publish of that venue fail with `invalid_design` (`publish.ts:299-306`), while the editor quietly shows Basic, and Done stays disabled until the owner changes something. Under or/foundation the same row published the default theme. Only a hand-edited or pre-validation row can hold this, because the old `setVenueTheme` parsed the theme strictly. | `migration-0045.test.ts`: the cases overridesSchemeString, overridesBadHex, overridesUnknownScheme, overridesNested and overridesUnknownRole give recordParses false and publishRefused true. | 0.8 |
| DA-B3-4 | low | `packages/db/migrations/0045_design_record.sql:50-60` (Corners and Depth mapping) | ticket #170 acceptance "the guest page draws as before"; decision 129 "draws what it draws today" | The old sliders allowed corners from 0 to 24 px and shadow from 0 to 5 (or/foundation `style-panel.tsx:7`). After the next publish, a venue at radius 13 draws at 16, 32 at 24 and 4 at 8, and any shadow from 0.5 to 5 draws at 1. Ticket #170 itself asks for "the nearest corners and depth words", so the ticket contradicts its own acceptance line. | `migration-0045.test.ts`: the cases full (13→16, 3→1), radius32 (32→24, 5→1) and radius4 (4→8, 2→1). | 0.9 |
| DA-B3-5 | low | `packages/db/migrations/0045_design_record.sql` (picks each valid field), against or/foundation's `readVenueTheme` (strict parse of the whole theme) | ticket #170 "draws as before" | If a hand-edited theme had valid colours plus one invalid field (an extra key in `colors`, no `logo_asset_id` key, an unknown preset, `overrides` given as a string or an array, a malformed logo id), it drew the default theme before. After 0045 it draws its colours. Shadow 0.4 now draws as 0 instead of 1, and radius -5 as 0 instead of 8. This is better data, but it is not "as before". | `migration-0045.test.ts`: the cases coloursExtraKey, noLogoKey, unknownPreset, overridesString, overridesArray, logoMalformed, badScalars and negativeRadius. | 0.85 |

## Observations

| # | Observation |
|---|---|
| O1 | **Item 1, the old app's data:** every venue shape the old app could write gives a record that parses. Palette, roles, font, logo, screen and layout are unchanged, apart from DA-B3-4. A theme that is a string, an array or null, or colours that aren't colours, draws the default before and after. |
| O2 | **Item 2, owner without BYPASSRLS:** I ran 0000-0047 as `da_b3_owner` (rolsuper f, rolbypassrls f; under forced RLS it sees 0 venues). All 35 venues of both tenants got `design`, the same table as the superuser run. Forced RLS on venues, menus and design_styles is back after the run, and `venues_touch_updated_at` is enabled again. CI still never runs migrations this way (RR-O9). |
| O3 | **Item 2, a venue that already has `settings.design`:** 0045 skips it (`WHERE NOT settings ? 'design'`), so its `theme` stays and a junk `design` stays invalid (case designAlready). Only possible from a hand edit or an earlier dev build of the wave. |
| O4 | **Item 3:** a venue with no colours or with three colours: a first save that changes nothing is UNCHANGED (`apply.ts:1674`). Brand-only venues are DA-B3-2. |
| O5 | **Item 4:** all 34 old snapshots (17 fixtures, each with presentation `qr-phone` and with `editorial-market` and its old options) parse with `loadSnapshot`, build a view model with `design` = Basic (`packages/shell/src/build.ts:475`), and draw `[data-face="editorial-market"]` on the guest page in the snapshot's scheme, with no error screen (`apps/web/src/da-b3/old-snapshot-guest.test.tsx`, 36/36). There is no blank page. The face in the snapshot is ignored (`guest-menu.tsx:115`, `faceEntry(null)`). |
| O6 | **Visible change on deploy:** on or/foundation the default face drew every venue as Editorial Market. From the deploy, before any republish, every venue draws in Basic values. This follows decision 128 ("No existing venue is moved onto Editorial"), but guests will see the change at the deploy, so Martin should hear about it. |
| O7 | **Layout:** 0045 takes the layout from the live menu only. A menu reached through a menu route loses its own layout, as decision 129 (one design per venue) intends. |
| O8 | **Foreign logo:** 0045 carries any well-formed `as_` id without checking its tenant, and `setDesign` rechecks a logo only when it changes (`apply.ts:1665-1672`), so a foreign id survives saves. The publish reads assets under tenant RLS, so it is left out and nothing leaks (case logoOtherTenant). |
| O9 | **Parser first:** the snapshot's `design` block is read (`build.ts:475`) and written (`publish.ts`) in the same deploy. Old guest shells ignore the unknown field, so nothing breaks today, but it breaks the rule at data-architecture.md:725. |
| O10 | **Item 6, readers of events with no node:** the item history (`apps/web/src/server/item-sheet/service.ts:612`) filters on `node_id = item`, so those rows never show. `deleteNodes` (`purge.ts:154`) deletes by node id and leaves them. The venue purge (`purge.ts:493`, `scope = venue:<id>`) removes setDesign events. The change-log purge (`purge.ts:959`, older than two months, D96) removes setDesign, setStyle and setStyleStatus events. I found no other app reader, only scripts and e2e. |
| O11 | **Item 6, design_styles:** nothing purges `design_styles`. This matches D83, which purges a venue, never an organisation, and the note in `table-access.ts`. Its FK to tenants is ON DELETE RESTRICT (`0047_design_styles.sql:44`), so any future purge of an organisation must delete its Styles first. |
| O12 | **Item 7, grants:** after `db:roles` (re-run with the purge password; "privileges match src/table-access.ts (59 tables)"): `restro_app` has INSERT, SELECT and UPDATE, `restro_purge` has nothing, and the owner has everything. RLS is enabled and forced, and the policy `tenant_isolation` FOR ALL uses `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')` for both USING and WITH CHECK, the same as `enable_tenant_rls`. All provenance columns are NOT NULL; only `removed_at` is nullable. This matches `table-access.ts:138`. |
| O13 | **Missing test:** `packages/core/src/apply/design-migration.test.ts` uses only data the old app could write, runs as a superuser, and checks only colours and roles for the venue `whole`. It never checks radius and shadow (DA-B3-4), junk overrides (DA-B3-3) or brand-only first saves (DA-B3-2). |

## What I could not cover

- Real deploy timing on Railway (whether the pre-deploy step runs while the old release still serves traffic). I read the docs but ran no deploy. DA-B3-1 assumes it does, as Railway documents.
- Whether old radius and shadow values change what Editorial Market drew on or/foundation: the face may not use every token. I compared the theme values, not pixels.
- Real staging or production data: I can't see what junk exists outside my seeds. The counts are unknown.
- Attacks through the app (B4) and concurrent saves (B5) are not mine.
