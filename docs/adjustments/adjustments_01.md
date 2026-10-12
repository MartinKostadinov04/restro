# Adjustments 01: prompt for the implementing lead (Fable)

Decided by Martin (product owner, non-coder) with the previous lead in a Q&A session, 10-11 to 10-12. Full decision texts: `docs/tracker.md` (search `| D84 |` etc.); one-line index: `docs/decisions.md`. Where this file and the tracker differ, the tracker wins.

## 0. Your job and how to work

- **You are the lead for these adjustments.** First **plan**: work packages, order, dependencies, which files each package owns, model per package, and the migrations. Present the plan to Martin in plain language and wait for his OK. Then write briefs (`docs/agent-briefs/`), run the agents, review, merge, report.
- **Decide what you code yourself and what you hand to simpler agents.** Your plan says, per package, who builds it and why.
  - **Code it yourself** when it's complex or cross-cutting and a mistake is costly: data-model changes and migrations (M1, the purge role in V1), routing and snapshot resolution (M2), core rules every workflow depends on (L1, the D2 colour engine), and anything that changes a guardrail.
  - **Hand it to simpler agents** when it's well specified once the foundations exist: screens and forms (V2, V4, V5, D1, T1, P1, I1), wording, small connector changes (B2, B5). Use Sonnet by default and Haiku for exact, mechanical tasks (D58), each with a brief that pins the interfaces you built.
  - **Review every diff** yourself before it merges, whoever wrote it.
- **Read first:** `CLAUDE.md`, `docs/decisions.md`, this file. Look up decisions in the tracker by ID only; never read the tracker or `docs/architecture/data-architecture.md` whole.
- **Branch:** create `ad/foundation` from `sh/foundation`; task branches `ad/<nn>-<slug>`. Martin allows pushing `cf/**`, `sh/**` and `ad/**` for CI; never push `main`. CI (`.github/workflows/ci.yml`) must be extended to `ad/**`.
- **Process (Martin 10-11, 10-12):**
  - At most two agents at once; the strongest model for genuinely complex packages only (D58).
  - Agents run lint, typecheck, deps:check and only the tests of what they touched, plus a Playwright spec they wrote or changed. Never the full `pnpm test`, `pnpm build` or Playwright suite on the PC (now in `CLAUDE.md`, together with the three layers and the purge-role exception).
  - The lead pushes the task branch, waits for CI green, then merges.
  - Briefs name the decisions and doc sections to read. Reports are at most one page.
  - Never enter plan mode while agents run.
- **Rules that bind every change:**
  - The nine rules in `CLAUDE.md`.
  - Guardrails only tighten (D67). One approved exception: D83's purge role.
  - Vendor words ("barsy") only in a connector's package or the `connectors/` folders. CI enforces this with `scripts/vendor-words.test.ts`.
  - Every new decision or task goes into the tracker and `docs/decisions.md` in the same commit.
- **Acceptance:** Martin checks each wave on port 3000 (local database `restro_accept`; migrate it locally). Staging migrations need Martin's OK.
- **Three layers, kept apart:**
  1. **Platform** knows no POS.
  2. **The integration layer** is how any POS, or "by hand", plugs in.
  3. **The barsy connector** holds barsy's fields only.
- **Already built (context, not to redo):**
  - D75: barsy's own name stands in for a missing public name, and the composer warns (CF-17).
  - D76: rename, archive and restore a venue (CF-18; `venues.archived_at`, migration 0017; core `apply/venue-lifecycle.ts`, `apply/venue-lock.ts`).
- **Concluded:** the database stays one Postgres. JSON arrives from the till, rows hold the merged, layered model, and JSON snapshots go to guests. No second store.

## 1. Platform (source-agnostic)

### V1 Venue bin and purge: D83, D90, D91
- **Now:**
  - Delete archives the venue and releases its till link; the worker withdraws `v/<code>.json` and the table files.
  - Restore (Organisation › Settings › Deleted venues) brings it back without a till link.
  - Nothing is ever erased: the app role has no DELETE (`packages/db/src/table-access.ts`).
- **Change:**
  - **Bin and purge:** a 30-day bin, then a worker purge job erases the venue's own data: menus, sections, venue-scoped values, tables and tokens, tags, snapshots and CDN files, events, job runs. "Delete permanently" (owners, typed name) purges at once.
  - **What survives:** tombstones keep the public code and table tokens from ever being reissued. Data another venue uses stays. The purge also clears a removed POS instance's data and items no venue uses.
  - **Restore** re-links the till venue if it's still free; otherwise it's refused, naming the venue that holds it.
  - **Custom domains:** a domain on a deleted venue shows "not available" and is detached on purge.
- **Guardrail (approved by Martin):** a dedicated database role with DELETE, used only by the purge job. The app role keeps no DELETE. Pin both with tests.

### V2 Venue states and the All venues card: D86
- **Now:** `app/(admin)/venues/page.tsx` with `components/admin/venue-card.tsx`. There are no states. Nothing unpublishes except deleting the venue.
- **Change:**
  - **States:** Draft (never published, or unpublished), Live (its live menu is published), Archived (in the bin).
  - **An Unpublish action:** withdraws the guest files and returns the venue to Draft.
  - **The card shows:** display name, state, POS instance (or "By hand"), the venue's name in that POS, and a link to the full menu preview (the whole menu, no table; its look is designed later).

### V3 Clean guest addresses: D84
- **Now:**
  - The address is `/m/<slug>-<code>` (D68). The slug is cosmetic and not unique; `venues.public_id` (12 characters) finds the venue.
  - The CDN index is `v/<code>.json`; the route is `apps/web/app/m/[venue]/page.tsx`; core has `renameVenueSlug`.
- **Change:**
  - **The address** becomes `/m/<organisation>/<venue>`. The organisation part is its slug (Better Auth `auth_organization.slug`, unique platform-wide); the venue part is unique within the organisation.
  - **Both parts** are generated from the names and editable; old names keep redirecting.
  - **The public code** becomes an internal CDN key only, and old `/m/<slug>-<code>` links redirect.
  - **`/t/<token>`** is unchanged.

### V4 New venue form: D85, D87
- **Now:** `components/admin/new-venue-dialog.tsx` asks for name, slug and languages, and is for hand-made venues only. POS venues are created from Integrations' Till venues card ("Add as venue" or "Link to existing").
- **Change:**
  - **Step 1, the source:** an active POS instance, or "By hand".
  - **From a POS:** pick the instance's venue (linked ones show "linked to …" and can't be picked). Nothing is typed: the name comes from the till, the address from the name, the languages from L1.
  - **By hand:** name and languages; an editable address preview.
  - **The source is fixed after creation:** no "Change" or re-link anywhere. Going from hand-made to a POS isn't supported.

### V5 Organisation › General: D91
- **Now:** Settings has only "Integrations" and "Deleted venues" (`components/admin/settings-sections.ts`). Renaming the organisation is disabled over HTTP (`DISABLED_HTTP_PATHS` in `apps/web/src/server/auth.ts`).
- **Change:** a General section for the organisation's name and its address slug (V3), through a server action.

### M1 Several menus per venue: D88, D90, D91, D92 (the foundation of M2, C1, P1)
- **Now:**
  - One menu per venue: `menus_venue_id_unique`; `provisionMenu` is idempotent; the app role has only SELECT and INSERT on `menus`.
  - `snapshots` and `publish_pointers` are keyed by (menu, venue). The guest page loads the venue's one menu.
- **Change:**
  - **Many menus, exactly one live.** The live one is chosen in Settings › General › Menus (each row has a ">" into the composer) or in the composer.
  - **Hand-made venues** add, rename and delete menus. A deleted menu goes to the venue's 30-day "Deleted menus" bin, then is purged.
  - **barsy venues:** their menus come from barsy (see B3).
  - **Versions:** each menu has its own draft and published versions. The venue is Live when its live menu is published.
  - **Header name** per menu, defaulting to the venue's name.
  - **Shared by all menus:** one template (shell), one design and one set of guest features per venue.
  - **Import menu** ("From other venue"): hand-made to hand-made only, as a one-time copy.

### M2 Menu routing: D95, D91 (depends on M1)
- **Now:** a QR token finds its table (`places`), which finds the venue's one menu.
- **Change:**
  - **A dictionary:** the venue's live menu → an area menu overrides it → a table menu overrides the area. The most specific entry wins, and an unpublished menu falls back to the next level.
  - **One menu per code,** with no guest switch.
  - **Published so guests never need the database (rule 4):** resolved into the table files and the venue index.

### C1 Composer › Structure: D89, D90, D91, D92 (depends on M1)
- **Now:** `apps/web/src/composer/*`.
  - Sections and placements use fractional sort keys.
  - `venueHasTill` (D66) blocks new items on till venues.
  - Names over the till's go to the override layer through the item sheet (`name` resolves source-first).
  - The composer also holds the Guest features and Tags panels.
- **Change:**
  - **Subtabs:** Structure and Design. The venue's Design tab moves in (D1).
  - **Hand-made venues:** full create, edit and delete of menus, sections and items.
  - **POS venues, structure:** a mapper (placements and order, including own sections and moving items between sections) and a dictionary (our name, description and photo over the till's), plus hide, sold out and tags.
  - **POS venues, never:** create or delete items or till sections, or change prices. Syncs rewrite only the till layer, and new till items land at the end of their category's section (D20).
  - **Sections:** each is vertical or horizontal, published as a layout hint. The face draws a horizontal section with its delivered "feature strip" (`packages/faces/editorial-market/src/section.tsx`, `.is-feature` in `css.ts`), replacing the template option `featureFirstSection`.
  - **Menu layout** (list, one or two columns): a default plus "guests may switch", replacing the template options `layout` and `layoutSwitch`.
  - **Moves:** "Overrides to review" becomes a badge on the item. The Guest features panel moves to Design.

### D1 Composer › Design: D92
- **Now:** the venue's Design tab (`apps/web/src/design/**`).
  - A template gallery.
  - The colour picker:
    - 4 preset chips plus Custom, and three pickers;
    - "Suggest" with 5 harmony rules, and a colour-swatch palette;
    - the 8 computed colours for light and dark, with overrides and contrast ratios.
  - 6 fonts shown as cards; corner and shadow sliders; logo; light/dark policy; template look options.
  - A live phone preview.
- **Change:**
  - **The template chooser** sits at the top, collapsed, with a phone preview pop-up (the general menu preview, no table).
  - **The cards, in order:**
    1. Logo and the menu's header name.
    2. Guest functions, in their own section.
    3. Font (a dropdown), corners, shadow, screen.
    4. Colours: brand-first (D2), no presets, no swatch palette, the computed colours under a collapsed "Advanced".
  - **A sticky phone-size preview** beside the cards; you decide how.
  - **Design changes** reach guests on the next publish of the venue's menus.

### D2 Colour system: D93 (with D1)
- **Now:** `packages/core/src/theme/derive.ts` derives 8 roles in OKLCH, gamut-safe, with 4.5:1 text contrast and a hue-preserving dark transform. The face mixes about 40 colours of its own with `color-mix(in srgb)` (`css.ts`, `services/services-css.ts`), and none of them is checked.
- **Change, must:**
  - **New engine roles** for everything that carries text or meaning: error and success with their text colours, disabled and sold-out text, selected chip fill with its text, focus ring, sheet backdrop, a strong control border.
  - **Decorative tints** may stay in the face, blended `in oklab`.
  - **A contract test** checks every text-on-colour pair the face draws.
  - **3:1 for controls:** the strong border and focus ring meet it. A highlight under 3:1 stays as chosen, but buttons get the strong outline and the Design tab explains why.
  - **The colour card starts with "Your brand colour"** (Tertiary). Page and panels are pre-filled as calm tints and stay editable, with a warning when the page colour is strongly saturated.
- **Change, should:**
  - **Softer accents** on the dark screen.
  - **APCA** as a second check (body text Lc 75, small secondary text Lc 60), built in-house; check its licence first.
  - **A `prefers-contrast: more` variant.**
- **Constraint:** all additive, so old snapshots and faces still work.

### L1 Central menu languages: D77, D91
- **Now:**
  - `LOCALES` (`packages/core/src/locales.ts`) is a fixed list of barsy's 11 keys.
  - An organisation-level `integrations.config.default_locale` sets the language of untagged till text (Integrations' mapping card).
  - `venues.default_locale` and `enabled_locales` are chosen at creation and read-only afterwards; the resolver, publisher and composer use them.
- **Change:**
  - **One core function every workflow calls:** sync, new venue, settings lists (with coverage), composer tabs, resolver checks, publisher.
  - **For POS venues:** a language counts from about 20% coverage of guest-facing texts, from the connector's report (I3). A language the owner switched on is never removed.
  - **For hand-made venues:** the owner's choice.
  - **One main language per venue.** The organisation-level setting goes.
  - **A guardrail test** stops workflows reading `enabled_locales` directly.

### T1 Tables & QR: D94, D95 (routing UI depends on M2)
- **Now:**
  - Tables exist only as barsy places: `places` (integration, bid, place_id, place_num, salon_name, is_public, qr_token, label).
  - Halls are grouped by name, and every place gets a code, non-public ones included. Hand-made venues have no tables.
  - The "Address in the codes" card asks for a base address or an own-link pattern (`venues.settings.qr`, D61). The page is a long list.
- **Change:**
  - **The address card is read-only:** your verified domain, otherwise our address, with a link to Organisation › Domains. The test link and the printing warning stay; the Wi-Fi testing address becomes developer config `PUBLIC_BASE_URL`.
  - **Hand-made venues** create, rename and delete areas and tables.
  - **barsy venues:** see B5.
  - **Layout:** each area shows its tables as a grid of cards: name, number, code status, and the menu shown (marked when overridden).
  - **The name field** is labelled as the name guests see, with "from barsy: N" beside it.
  - **The routing UI** sets menus per venue, area and table (M2).

### P1 Publishing and the venue page: D96, D97, T76 (depends on M1)
- **Now:** the venue's Publishing tab (`apps/web/src/publish/*`, core `apply/publish.ts`, worker `publish/after-sync.ts`).
  - **Its sections:** "On guests' phones now", "Changes waiting" (a diff summary), held-publish, paused and address-off banners, "Overrides to review", Versions, and a Rules card.
  - **Versions:** all kept forever, 20 per page.
  - **Rules:** `after_sync` auto/manual and `new_items` show/hold, stored in `venues.settings.publish`.
  - **Elsewhere:** the rollback pause sits in `integrations.config.publish.auto_paused` (T76); the sync schedule in `integrations.config.schedule` (`packages/core/src/sync-settings.ts`).
- **Change:**
  - **Venue tabs:** Composer, Tables & QR, Settings. Settings gets sub-tabs General, Publish and Versioning; the Publishing tab goes.
  - **A Publish button top right on every tab**, in both modes. It's greyed when nothing differs, shows the reason when blocked, carries a change count and opens a confirmation listing the changes. With several menus it becomes a dropdown: each menu, its areas in brackets, its change count. Per-area counts need new logic. "Open the guest page" sits beside it.
  - **Settings › Publish = Automation settings**, POS venues only:
    - sync mode, automatic (interval and daily full-read time in the venue's time zone) or manual;
    - "publish automatically after a sync".
  - **Removed:** the `new_items` rule, "On guests' phones now", "Changes waiting".
  - **The rollback pause** becomes per venue.
  - **Settings › Versioning:** the live version plus up to 2 restorable. Any non-live version is purged once older than 30 days, even among the last 2. The change log is kept 2 months.
  - **Warnings that need action** (held publish, paused, address off) show under the venue header on every tab.

### DM1 Custom domains: D80 (blocked: provider decision, section 4)
- **Change:**
  - **Organisation › Domains, self-service:** subdomains only; each domain serves one venue (`menu.club.bg`) or the organisation (`menu.group.bg/<venue>`); DNS verification and automatic HTTPS (proposal: Cloudflare for SaaS).
  - **Only the guest menu and table codes** are served on a custom domain.
  - **Routing never touches the database:** from a published `d/<host>.json`.
  - **A host belongs to one tenant platform-wide.** Codes print with the domain.

## 2. Integration layer (any POS, or by hand)

### I1 Integrations screen, source-agnostic: D81
- **Now:** `app/(admin)/settings/integrations/page.tsx` renders `IntegrationPanel` (`apps/web/src/integration/*`: ConnectCard, StatusCard, TillVenuesCard, MappingCard, SyncCard, RunHistoryCard). One barsy connection. The `integrations` table allows several rows but has no name (`kind` is checked as `'barsy'`).
- **Change:**
  - **A systems picker**, saved per organisation, and one tab per chosen system.
  - **Named instances** ("barsy – Sofia") with "Add {system}". Each has its connection form, status, system settings, "Sync everything now" and a collapsed run history.
  - **The Till venues card goes** (V4 replaces it).
  - **Refusals:** removing an instance while venues link to it; unselecting a system while it has instances. Connections are never erased.
  - **Wording:** every text uses `{POS name}`, never "barsy" hard-coded.
  - **Migration:** a connection name and the chosen systems.

### I2 Settings ownership: D82
- **Now:** the schedule, default language and rollback pause sit on the connection.
- **Change:**
  - **The instance owns what's true for the whole connection:** connection, status, system settings (barsy: the allergen characteristic), sync everything, all runs.
  - **The venue owns what's true for that venue:** main language (L1), menu source, sync mode (P1), its own collapsed history, "Sync this venue", publishing rules, the rollback pause.
  - **The venue's Menu source card** has a common part (instance and till venue, "Sync this venue", history, held-sync warning) and a part supplied by the connector, shown only for its venues. A hand-made venue shows neither.

### I3 Connector language report: D77 (feeds L1)
- After each complete full read, the connector reports the languages its POS offers and how many guest-facing texts each one fills. The connector reports; core decides.

### Parked: D79
- The pilot's till is Mistral (Zamboo), with no API docs yet. CF-05, 06, 07 and 08 (`docs/reviews/connector-architecture/readiness.md`) and the Mistral connector wait. Halls and tables for other POS systems stay undecided until their docs are read.

## 3. barsy connector

### B2 Price shown: D91, P52 settled
- **Now:** a Base/Current radio in the venue's Menu source (`barsy_venues.price_source`).
- **Change:** it stays, as the barsy part of Menu source only. Base price (`actual_price`) is the default. Current price (`current_price`) carries a warning that time-based price rules may show late until Lukanet answers Q43.

### B3 A barsy venue's menus: D88, D87 (with M1)
- **Now:** each venue picks a catalogue root from the whole tree (`barsy_venues.catalogue_root_cat_id`). `public_cat_id` is only a hint (CF-12).
- **Change:**
  - **No root picker.** A barsy venue's menus are the roots barsy designates for it: its public menu (`public_cat_id`, live by default) and its till tree (`cat_id`), both from `Barsys_getlist`. Other branches aren't menus, and sub-branches are sections.
  - **The sync reads both roots.**
  - **Re-check barsy's doc wording** for these two fields (docs.lukanet.com needs Martin's sign-in).

### B5 barsy halls and tables: D95
- **Now:** halls are grouped by `salon_name`, and non-public and "--" places get codes.
- **Change:**
  - **Keys and order:** halls keyed by `salon_id`, ordered by `salon_weight`.
  - **Allowed:** rename (`places.label` is the dictionary), reorder, hide. Never create or delete.
  - **Hidden by default:** non-public and placeholder places.

### B6 Allergen characteristic: D82
- It stays a barsy instance setting (barsy defines characteristics once per installation). Sample values wait on P-01.

## 4. Not decided yet: don't build until Martin decides
- **P-01** Show a sample value beside each barsy characteristic in the allergen setting.
- **P-02** Offer only barsy sales venues ("Търговски"), not production or service units ("Производствен", "Услуги").
- **P-05** Store barsy's `Languages_getlist` on the connection and count filled languages from guest-facing `_ml` fields. This is barsy's report for I3, so L1 needs it.
- **P-06** A venue profile (address, phone, opening hours, description, website), filled by the till or typed by hand.
- **P-07** Make a venue's languages, time zone and closing time editable.
- **DM1's provider:** Cloudflare for SaaS (price to confirm), or leave domains for later.
- **Minor:** whether the composer hints that horizontal sections work best with photos.

## 5. Blocked outside the code
- Mistral API docs (T69, Martin).
- Lukanet's answer to Q43 (price rules and `current_price`).
- APCA licence check.
- barsy doc wording for `public_cat_id` and `cat_id`.
- **Test data:** Demo Club Sofia in `restro_accept` mixes 127 items from three till venues. Recreate it after B3 and M1 (D87).

## Martin's notes
