# A4: Admin app (`apps/web`), readiness for several connectors and for venues with no till

Reviewer A4 · read-only · 2026-10-11 · paths relative to `E:\Restro`. **Fact** = seen in code, **Inference** = my reading.

Per the lead's scope change, spreadsheet import is out. Nothing below is proposed for it. Three web lines still mention the `import` layer and go away with core's removal: `server/item-sheet/layers.ts:24`, `server/item-sheet/plan.ts:187`, `composer/item-sheet-support.ts:55`.

## 1. Scope read

- **Docs:** CLAUDE.md, tracker D38–D64 and T47–T69, the data-architecture sections you named, and A1 and A3.
- **Admin app, read in full or in the relevant parts:**
  - `app/(admin)` (venues list, venue workspace) and `app/(print)`, `app/api/tables`.
  - `components/admin/*`, all of `integration/`, `server/integration/*`, `tables/` and `server/tables/*`.
  - `composer/*` (actions, ops, view-model, badges, item sheet), `server/item-sheet/*`, `server/publish/{service,load}.ts`, `fields` (provenance), `appearance`, `server/roles.ts` and `session.ts`.
  - `messages/*.json` (scanned by key).
- **Core and db, read only where the web calls them:** `core/apply/{tables,barsy-venues,provision,job-runs}.ts`, `core/jobs.ts`, and the `venues`, `integrations`, `barsy_venues` and `places` tables in `packages/db/src/schema.ts`.
- **Size of the coupling:**
  - 60 non-test files in `apps/web` name barsy (33 in code, 27 only in comments).
  - 47 test files and 7 e2e specs mention it.
  - Each message file has 90 strings that name it: integration 35, itemSheet 30, composer 12, tables 6, publish 4, workspace 2, fields 1.
- **Web never imports `@restro/barsy`** (rule `.dependency-cruiser.cjs:108-113`). So the coupling is in names, string literals and screen shapes, not in imports.

## 2. Scorecard (the parts that apply to the web)

| Part | Score | One-line evidence |
|---|---|---|
| 1 Own model (view models) | 2 | Tables, sections, items and prices are neutral (`server/tables/view.ts`). Origin, hidden-by and provenance are literal `'barsy'` (`composer/view-model.ts:40,62-67`; `fields/types.ts:41`). |
| 2 Connector plug (UI side) | 1 | Fixed host, user and password form (`integration/connect-card.tsx:118-161`; `server/integration/actions.ts:39-45`). Kind hard-coded (`service.ts:149,462,480`). No manifest or capabilities. |
| 4 Own ids, theirs as links | 3 | Ids are never drawn. `bid` and `catId` travel back only as picker keys (`server/integration/view.ts:29-32`). |
| 5 Connections ↔ venues | 1 | The Integration tab sits inside a venue but shows org-level data. The connection is "mapped one, else first barsy" (`service.ts:137-161`). Saving replaces it (`:456-485`). No venue-creation UI. |
| 6 Sync engine (UI side) | 2 | Gate, active job and run history are connection-shaped. They read barsy queue names from `pgboss.job` (`service.ts:219-224`) and `barsy_*` run kinds (`integration/format.ts:64`). |
| 7 Write-back | n/a | No UI yet, and none is needed before Stage 4. |
| 8 Contracts and tests | 1 | 47 tests hard-code barsy. There is no neutrality test and no test over a second manifest. |
| Tenancy / RLS | 4 | Every read goes through `withTenant`, and roles are read from the database (`server/roles.ts`, `session.ts`). |
| Secrets per connection | 3 | The password is sealed in the action, never returned, and the form clears it (`connect-card.tsx:45-63`). The fields are fixed to user and password. |
| Observability per connection | 2 | Status, last check and 20 runs per connection (`service.ts:175-182`). No health summary. Barsy-only labels. |
| UI by capabilities | 1 | The tab list is static (`workspace-tab-defs.ts:22-28`). The gate says `no_barsy_venue` (`gating.ts:29`). |
| Over-engineering | OK | Nothing speculative today. |

## 3. Findings

| Id | Severity | F/I | Where | Why it matters |
|---|---|---|---|---|
| A4-F1 | blocker | Fact | `app/(admin)/venues/page.tsx:31-40`; message `venues.empty.description` ("set up together with the Restro team"); `provisionVenue` called only from `scripts/seed-*.ts` and tests; `server/auth.ts:90` provisions the tenant only | No production path creates a venue. T68's "Add as venue" and D64's no-till venue both need one. |
| A4-F2 | blocker (no-till) | Fact | `composer/ops.ts:55-81` (only `createSectionOps`); `composer/actions.ts:159-172`; item `createNode` only in `scripts/lib/demo-menu.ts:291,371` | A hand-built menu can hold sections but no items. Neither A1 nor A3 noticed this. |
| A4-F3 | blocker | Fact | `core/apply/tables.ts:111-125,136-150,171-190,209-225,333-354` (all join `barsy_venues`); `tables/tables-panel.tsx:35-52` | Tables exist only through a barsy venue. A venue with no till, or a till X, gets the empty state "Tables come from barsy". |
| A4-F4 | blocker | Fact + Inference | `composer/view-model.ts:216-219`; `server/item-sheet/service.ts:139-150`; `plan.ts:112,115,124` | "Linked to the till" means `source.startsWith('barsy:')`. A till X item is treated as hand-made, so the sheet offers to edit its price into the manual layer (rule 5). Inference: core's `validateWrite` has the same prefix test (A1-F2), so both guards fail together. |
| A4-F5 | blocker | Fact | `server/integration/service.ts:456-485,502-508` | Saving a connection updates the single existing integration. A new host wipes its venue choices, cached trees and sync state. A second connection cannot be added, so a second till would overwrite the first. |
| A4-F6 | blocker | Fact | `connect-card.tsx:118-161`; `actions.ts:39-45`; `service.ts:395-400,428-440`; `server/integration/host.ts:24` | Credential fields, action schema and host rule are barsy's. A kind with an API key, token or different host rule has no form. |
| A4-F7 | significant | Fact | `app-sidebar.tsx:84-105`; `workspace-tab-defs.ts:26`; `page.tsx:82-88`; `service.ts:621-626` | There is no organisation-level settings area. The Integration tab is per venue, yet its sync and publish settings are saved on the shared connection, so one venue's change affects the others. |
| A4-F8 | significant | Fact | `integration-panel.tsx:30-36`; `gating.ts:24-33`; `tables-panel.tsx:47`; message `tables.empty.description` | No control reads capabilities. Scope picker, schedule and "connect barsy" empty states are always shown. |
| A4-F9 | significant | Fact + Inference | `barsy-venue-card.tsx:27-35`; `catalogue-root-card.tsx:137-145`; `core/apply/barsy-venues.ts:109-124`; message `integration.barsyVenue.switchHint` | Source switch (T62) is one radio click with no confirmation or preview. The hint says old items "stay in the menu", which T62 shows is wrong. Inference: the old venue's table files `t/<token>.json` are never retired, because only `deleted` places retire tokens (`barsy-venues.ts:304-312`). The old stickers keep working yet vanish from the tab. |
| A4-F10 | significant | Fact | `server/tables/service.ts:85-110`; `tables-panel.tsx:124`; `schema.ts:791-792`; `core/apply/tables.ts:354` | T66 and T67 in the web. Halls are grouped and keyed by name, so same-named halls merge. `places` has `salon_name` and `is_public` but no hall id or place type, which T66 assumes ("`salon_id` kept in `places`"). Non-public places are coded. One empty state serves every reason, and `QrAddressCard` is hidden while empty. |
| A4-F11 | significant | Fact + Inference | `server/publish/service.ts:186-197`; `server/publish/load.ts:392-407`; `sync-settings-form.tsx:123` | Rollback's pause and the publish policy live on the connection and are found by a `barsy_venues` join. A venue with no mapping has no pause. Inference: two venues on one connection pause each other. |
| A4-F12 | significant | Fact | `composer/badges.tsx:13-49,56-70`; `fields/provenance-badge.tsx:10-16`; `item-sheet-support.ts:53-58`; messages (90 strings); `publish.actor.sync` | Wording cannot take a connection's name. A second till would read "From barsy". |
| A4-F13 | significant | Fact | `integration/format.ts:6-20,64`; `service.ts:219-224,652` | Neutral job names (A3-P2) would silently make "Sync now" and the busy state show idle and mislabel every run. |
| A4-F14 | significant | Fact | `mapping-card.tsx`; `service.ts:575-600`; `server/integration/tree.ts:49-77`; `venue-settings.tsx:15,49` | The Mapping card is a fixed barsy card (price source, allergen key). Its "default language" is the language of untagged barsy text, not the venue's language, which is read-only. |
| A4-F15 | minor | Fact | `schema.ts:305-321` | A connection has no name. The UI shows the host (`status-card.tsx:110`). Two connections of one kind are indistinguishable. |
| A4-F16 | minor | Fact + Inference | `publish/load.ts:448-458`; `composer-tab.tsx:40`; `server/menus.ts:20-33` | Multi-venue (T50) leaks. The "last run" is the tenant's latest, and held-new ids are tenant-wide. Composer actions look nodes up by tenant only (Inference: venue A's URL could change venue B's node; no privilege issue). |
| A4-F17 | minor | Fact | `server/roles.ts:9-31`; `composer/actions.ts:202-217` | `canManageIntegration` also gates publishing and sold-out, which is a naming problem only. `createMenuAction` has no role check. |
| A4-F18 | minor | Fact | `composer/item-sheet-sale.tsx:39,79`; `composer/reducer.ts:147,223` | Positive: no control for items the till has off sale (rule 5), and sold-out-tonight works with no till. Both must survive the rename. |

The admin shows no modifier groups at all (Fact: no "modifier" under composer, server or fields). Till X's modifiers would be invisible, as barsy's are today.

## 4. Walk-throughs

### (a) Second till "X"

Files that change, with nothing else done first:

| Area | Files |
|---|---|
| Pages and frame | `app/(admin)/venues/[venueId]/page.tsx`, `venues/page.tsx`, `components/admin/{app-sidebar,workspace-tab-defs,venue-card}.tsx`; new `settings/integrations` pages |
| Integration UI (10) | connect, status, barsy-venue, catalogue-root, mapping, sync, sync-settings-form, run-history cards; `format.ts`, `integration-panel.tsx` |
| Composer and fields (17) | `badges`, `view-model`, `reducer`, `composer`, `item-row`, `row-menus`, `sold-out-chip`, `item-sheet` and its details, history, media, translations and sale tabs, `item-sheet-support`; `fields/{types,provenance-badge,editable-field-row,samples}` |
| Tables and publish | `tables-panel.tsx`, `table-row.tsx`, `publish/names.ts`, `paused-banner` text |
| Services and actions | `server/integration/{service,actions,gating,host,tree,view}`; `server/item-sheet/{service,plan,layers,types}`; `server/publish/{service,load}`; `server/tables/{service,view}`; `roles.ts` |
| Messages | `en.json` and `bg.json`, 90 strings each. BG needs Martin's review (T44). |
| Tests | 47 test files and 7 e2e specs |

After A1 and A3 and the proposals below, X needs **no code in the web**: one manifest entry (credential fields, option fields, capabilities), `connectors.x.*` message keys in both languages, and one test fixture. What X's features need in the web:

| X feature | Web today | Web with the proposals |
|---|---|---|
| Locations | Radio list of barsy venues | Locations table: Add as venue / Linked to / Not used (P6) |
| Categories, products, modifiers | Sections and items are neutral; modifiers invisible; origin badge says "barsy" | Badge takes the connection name (P4). Modifier display is out of scope until Stage 4 (Q8). |
| Per-location prices | Price read-only when the link is `barsy:` | Same rule, keyed on the till role (P4) |
| Availability flags | "Not on sale in barsy" | "Not on sale in {source}", capability-gated (P3) |
| Tables | Barsy join only | Neutral locations and tables (P11, P12) |
| Webhooks, not polling | Schedule form always shown | Schedule card shown for `poll` only; push connections show last event and "Read now" (P14) |
| Order API | Nothing | Only a capability slot (`orders`). No UI before Stage 4. |

### (b) Venue with no till, step by step

| Step | Works? | Where it breaks |
|---|---|---|
| Create the venue | No | A4-F1: no UI. An operator runs a script or SQL. |
| Open it, create the menu | Yes | `NoMenu` → `createMenuAction` → `provisionMenu` (`composer/no-menu.tsx`, `actions.ts:209`) |
| Build sections | Yes | `createSectionAction`. Copy says "The menu from barsy arrives here" (`composer.empty.noSections.description`). |
| Build items | **No** | A4-F2: no way to create one. Once an item exists, the sheet edits price, allergens, image and translations in the manual layer (`plan.ts:112` returns null for unlinked). |
| Tables and QR | **No** | A4-F3: no table can exist. `lockTable` returns null without a mapped barsy venue (`tables.ts:209-225`), so no code can be issued. The empty state links to the Integration tab. The QR address card and print sheet are unreachable. |
| Publish | Yes, if an item exists | `publishNow` has no integration check (`publish/service.ts:91-112`). With no items: "No menu to publish yet… or connect barsy". Rollback's pause is a no-op, which is acceptable. |
| Sold out tonight | Yes | Service-edition mark; `offSale` is null |
| Venue settings | Read-only | `venue-settings.tsx:49`. Time zone, languages and currency are fixed at creation. |

Three gaps decide it: venue creation, item creation, and tables. Publishing, the guest page and sold-out already work.

## 5. Proposed adjustments

Tiers follow D58. "Stage 4" is the phone-ordering stage (D39). All changes to `apps/web` unless stated.

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | Order |
|---|---|---|---|---|---|---|---|---|
| A4-P1 | **New venue** button, dialog and `createVenueAction` (owner/admin) calling `provisionVenue` + `provisionMenu`. Collects name, slug (suggested from the name, `slug_taken` handled), time zone, languages. Reuse `new-section-dialog.tsx`, `Empty` in `venues/page.tsx`, `ProvisionError`. | F1, F16 | M | Low | n | none | Sonnet | Before; start now |
| A4-P2 | **New item** in the composer: `createItemOps` beside `createSectionOps`, `createItemAction`, button in the item pane and empty states, opens the item sheet. Fix the empty-state copy. | F2 | M | Low (change set via `apply()`) | n | none | Sonnet | Before; start now |
| A4-P3 | **`getVenueSource(tenantId, venueId)`** (React `cache`, like `getVenue`) and a client context. Returns none-or-till, connection id and name, location, scope, status, capabilities. One pure `uiCapabilities()` with at most six flags: `tablesFromSource`, `scopePicker`, `schedule: poll\|push`, `soldOutFromSource`, `priceLocked`, later `orders`. Written first on barsy tables, then re-pointed to A1/A3 tables. | F8, F12 | M | Low | n | A3 capabilities on the row (a constant at first) | Sonnet | Before |
| A4-P4 | **Neutral names and wording.** `ComposerOrigin`, `ItemHiddenBy`, `Provenance`, `SheetProvenance` and `OffSaleBy` say `'till'`. "Linked" uses the till role, not `'barsy:'`. Messages use `{source}` (connection name). Vendor words only under `connectors.<kind>.*`. Remove the `import` references. Same PR as A1-P1; the compiler finds the sites. | F4, F12 | L | Medium (rule 5 tests must stay green) | n | A1-P1, A1-P9 | Sonnet, Haiku for the string sweep | Before |
| A4-P5 | **Settings → Integrations** (organisation). Pages `settings/integrations` and `[connectionId]`, a sidebar group. List (name, kind, status, last success, next run, "N new locations") and "Add connection". Detail cards: credentials, status, schedule, options, locations, runs. Re-key `loadState`, `perform()` and `syncGate` by connection id. Reuse `StatusCard`, `RunHistoryCard`, the schedule half of `SyncSettingsForm`, `FormSection`, `LiveRefresh`. Redirect `?tab=integration`. | F5, F7, T68 | L | Medium | n (y for P6) | A3-P4 (can start on `barsy_venues`) | Sonnet; lead reviews the gate | Before |
| A4-P6 | **Locations card:** Add as venue / Linked to … / Not used. A core writer `createVenueForLocation` (venue, menu and link in one transaction) and `setLocationIgnored`. A location needs a state of `new`, `linked` or `ignored`. | F1, T68 | M | Medium (tenancy, composite keys) | y | A1-P7, A3-P4, A4-P1 | Opus (writer), Sonnet (UI) | Before |
| A4-P7 | **Venue Source card** in the venue Settings tab, replacing the Integration tab. Shows the linked location (read-only, with a link to the connection page), the scope picker (reuse the `CatalogueRootCard` tree, shown only with the `scopePicker` capability) and publish behaviour (P13). Tab set drops to four. | T68, F7 | M | Low | n | P3, P5 | Sonnet | Before |
| A4-P8 | **Source-switch safety (T62).** Both pickers become two steps: a `previewSourceChange` action, then a dialog with the current linked-item count, "this replaces the menu", and the exact hidden count once A3's dry-run plan exists. Block a root with 0 categories (cached tree) or an active job. After unlink, ask whether to retire old table codes. Reuse `tables/confirm-dialog.tsx`. | F9 | M | Low | n | A3-P2 plan stage for exact numbers; a first version ships without | Sonnet | Before the pilot |
| A4-P9 | **Manifest-driven credentials form.** `CredentialsForm` renders `manifest.credentialFields` (text, password, host, url). The action validates with the manifest's Zod and seals through A1-P5. `parseBarsyHost` becomes a generic https-host rule. Password behaviour unchanged. Creating a connection no longer replaces another. Add `integrations.name`. | F5, F6, F15 | M | Medium (secrets path) | y (name column) | A1-P2, A1-P5, A3-P14 | Sonnet; lead reviews | Before |
| A4-P10 | **Options from the manifest:** price source, allergen key and untagged-text language become declared option fields rendered generically. Keep them apart from the venue's own language. | F14 | S | Low | n | P9 | Sonnet | Before the 2nd connector goes live |
| A4-P11 | **Tables, T66/T67.** Key and group halls by hall id (shown by name). Add hall id and place kind columns and mapper output (worker, coordinated). A "which places get codes" card by kind and hall, stored on the venue; non-public places skipped. The empty state names its reason (no location, no scope, never read) with a "Read tables" action. Show `QrAddressCard` while empty. | F10 | M | Medium (worker mapper) | y | A3 (mapper) | Sonnet | Before |
| A4-P12 | **Hand-made tables:** "Add tables" (number, range, hall) when `tablesFromSource` is false. | F3 | M (web S) | Medium (QR token job) | y | A1-P7, A3-P12 | Sonnet | Before |
| A4-P13 | **Publish policy to the venue (web side):** `afterSync` and `newItems` move out of the sync form to the Source card. `pauseOf` and `readPaused` read `venues.settings.publish`. `readLastRun` becomes venue-scoped. | F11, F16 | M | Medium | y (key copy) | A1-P6 | Sonnet | Before |
| A4-P14 | **Neutral status and runs.** Run kind and counter labels come from the key, with a generic fallback. `readActiveJob` uses a neutral job-name set exported by core, or a marker on the connection. Show health: last success, failing since, next run, last webhook for push. | F13 | M | Low | n | A3-P2 | Sonnet | Before; the push display with the first webhook connector |
| A4-P15 | **Enforcing tests.** (1) Fail if `/barsy/i` appears in `src` or `messages` outside an allow-list (`connectors/` and `connectors.barsy.*`). (2) Component tests over two fake manifests (poll with scope and tables; push with neither). (3) Playwright "no-till venue": create venue → section → item → tables → codes → publish → `/m/<slug>` and `/t/<token>`. | Part 8 | M | Low | n | each of the above | Sonnet | With each step |
| A4-P16 | Cleanups: rename `canManageIntegration` to `canManage`; role check on `createMenuAction`; composer actions verify the node belongs to the venue. | F16, F17 | S | Low | n | none | Haiku | Any time |

Wave 0 (start now, no dependencies): P1, P2, P16, the web half of P8, the empty-state work in P11. Everything else is wave 1 and comes before Stage 4, since T68 asks for the connector foundation first. Order UI is explicitly after Stage 4.

## 6. Keep as is

- **Action pattern:** server components read; thin actions call `requireTenant`, take the role from the database, parse strict Zod input and revalidate (`server/integration/actions.ts:65-92`). Reuse `perform()` for connections.
- **Credentials handling:** sealed on submit, never returned, form cleared (`connect-card.tsx:45-63`). Changing any credential re-asks all of them.
- **`syncGate`:** pure and shared by the page and the action. Rename the reasons only.
- **Rule 3 in view models:** no external id is drawn. Table views stay neutral with opaque tokens, the one-writer token job, the print sheet and the QR address card.
- **Rule 5 in the UI:** no "back on sale" for source-off-sale items (`item-sheet-sale.tsx:50`). The sold-out mark works with no till.
- **Workspace tabs declared once**, drawn twice, mirrored in the URL (`workspace-tab-defs.ts`). Extend it.
- **`LiveRefresh`** polling only while a job is active; `FormSection`, `Empty` and `ConfirmDialog` from the existing UI kit.
- **`withTenant` on every read**, and 404 for foreign ids.
- **All strings through next-intl in BG and EN.** `{source}` extends this.

## 7. Open questions

1. **Name and place of the organisation area.** The venue already has a "Settings" tab, so two "Settings" would confuse. Recommend a sidebar group "Organisation" with the entry "Integrations" (page title "Settings · Integrations"), and keep the venue tab "Settings".
2. **Does the venue Integration tab disappear?** Recommend yes, replaced by the Source card (P7), with a redirect for one release.
3. **Switch preview before A3's plan stage exists.** Recommend shipping the confirm dialog with the current linked-item count and the 0-category block now, and adding exact numbers later. Never silently allow a switch.
4. **Slug when creating a venue from a location.** It is the public address `/m/<slug>` and cannot be edited later (no editor exists). Recommend suggest-and-edit at creation, with a clear "this is your public address" line. Martin should confirm that slugs stay fixed.
5. **"Not used" as a stored state.** Recommend yes; without it the "N new locations" badge cannot work.
6. **Where table-code choices (kinds and halls) live.** Recommend on the venue, keyed by our own hall ids, and reset (with a warning in the P8 dialog) when the source changes.
7. **Hand-made items on a venue that has a till.** Allowed today for sections. Recommend allowing hand-made items everywhere, labelled "display only, not orderable" as the architecture doc says. Martin to confirm.
8. **Where modifiers get edited.** The admin shows none. Recommend a read-only list in the item sheet when Stage 4 needs it, and leave it out of the connector foundation.
9. **Disagreement with T66.** The schema has no hall id or place type in `places`, so P11 needs a migration and a worker mapper change, not only web work.
10. **Manifest placement.** A1 puts manifests in core as data and A3 puts the connector contract in a kit. The web can import only core, so the credential form and capabilities need A1's data manifest. Recommend keeping the manifest as data in core and the executable connector in the worker, and writing capabilities to the connection row at connect (A3). Both are needed.

## 8. Rules for the connector guide (admin-app side)

1. A connector contributes data to the UI: label, credential fields, option fields with defaults, capabilities and message keys under `connectors.<kind>.*`. It contributes no React.
2. The UI never branches on `kind`. It branches on capabilities and on the venue's source role (till or none).
3. A vendor name appears only in the manifest label and in `connectors.<kind>.*` messages. Every other string takes `{source}`. A test enforces this.
4. Credential fields are typed (text, password, host, url). Passwords are write-only, and changing any credential re-asks all of them.
5. A connection has a person-given name. A person links each location to a venue, and "Not used" is a state.
6. Switching a source, a location or a scope is a two-step action that shows what will be hidden before it is confirmed.
7. A missing capability hides its control with one explanatory line. It is never an error.
8. The web reads only Postgres (the connection row, capabilities and runs). It never imports a connector and never reads queue internals except through a neutral helper in core.
9. A new capability adds its manifest flag, a component test over a fake manifest and BG and EN message keys in one change.
10. Map engine error kinds to user-facing status codes (`wrong_credentials`, `host_refused`, …). The status card already does this for three codes (`status-card.tsx:25`).

### Critical Files for Implementation
- E:\Restro\apps\web\src\server\integration\service.ts
- E:\Restro\apps\web\app\(admin)\venues\[venueId]\page.tsx
- E:\Restro\apps\web\src\composer\view-model.ts
- E:\Restro\packages\core\src\apply\tables.ts
- E:\Restro\apps\web\src\components\admin\app-sidebar.tsx
