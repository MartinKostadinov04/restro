# Brief CF-09b: Integrations move to the organisation's Settings; each venue gets its Menu source

- **Model:** Sonnet 5.5.
- **Branch:** create `cf/09b-settings-integrations` from `sh/foundation` yourself.
- **Tasks and decisions:** T68, T62, CF-04 (in T70's roadmap); D64, D66, D67, **D73** (the map you build), **D74**. Read their full text in `docs/tracker.md` by number.
- **Runs alone** (the second slot stays free).

## Read first

1. `CLAUDE.md`, `docs/decisions.md`.
2. **D73 in full:** it says, setting by setting, what is organisation-wide and what is per venue. Build exactly that.
3. `docs/reviews/connector-architecture/cf-16-design.md` (merged): where each setting lives now:
   - **per venue**, on the venue's `barsy_venues` row: `catalogue_root_cat_id`, `catalogue_id`, `price_source` (null falls back to `integrations.config.price_source`, then `actual_price`; writer `setVenuePriceSource`);
   - **organisation-wide**, in `integrations.config`: the allergen key, the language of barsy texts, `schedule` (with an optional `time_zone`, default `Europe/Sofia`), and per-venue sync bookkeeping in `sync.<bid>`.
4. Today's screens and server: `apps/web/src/integration/**`, `apps/web/src/server/integration/**`, `apps/web/app/(admin)/venues/[venueId]/page.tsx`, `apps/web/src/components/admin/workspace-tab-defs.ts`.
5. CF-09a's work: `apps/web/app/(admin)/settings/**`, `apps/web/src/components/admin/settings-sections.ts`.
6. The publish policy: `apps/worker/src/publish/after-sync.ts` and where `publish_after_sync` / `publish.after_sync` / `new_items` are read and written (core `sync-settings.ts`, `apply/sync-config.ts`).
7. `docs/platform-reference.md`: only the settings or integration entries, if any.

## What to build

### 1. Settings → Integrations (organisation)

Replace the placeholder page (delete CF-09a's "still set up in each venue's Integration tab" note). Owners and admins change things; members see it read-only. Cards, in order:

1. **Connection:** address, API user, password (sealed as today), Save; the change-host rules of CF-02 stay.
2. **Status:** state, last check, "Check again", the warnings (currency, held pulls) with the venue they concern.
3. **barsy venues:** every venue `Barsys_getlist` returned, each with its state and one action:
   - **Linked to «venue»**: a link to that venue's Settings;
   - **Add as venue**: creates a Restro venue named after it (CF-01's `provisionVenue` path: public code, slug, defaults), links it, and sends the person to the new venue's Menu source card to choose the menu category;
   - **Link to an existing venue**: only venues with no link yet; same warnings as today's barsy-venue picker (T62);
   - **Not used**: hides it from the "to do" state (a shop, catering, "Services"); reversible. Store the set in `integrations.config` (no migration), and say so in your report.
4. **How barsy data is read:** the allergen field and the language barsy texts are written in (today's Mapping card **without** the price).
5. **Automatic sync:** check every N minutes and the daily full read, labelled in the integration's time zone ("Sofia time"); **Sync everything now**, which queues a pull for every linked venue with a menu category (the per-installation serial lock of CF-16 still applies).
6. **Sync history:** all venues' runs, with a venue column.

### 2. The venue: a Menu source card in its Settings tab

- **Linked:** its barsy venue (read-only) with **Change…** (today's picker and its T62 / CF-02 warnings: a change is deliberate), its **menu category** (today's catalogue picker), **Price shown** (base price or current price, written per venue with `setVenuePriceSource`; one line of help in plain words: "Current price follows barsy's price rules for this venue"), last sync, the held-sync warning, and **Sync this venue**.
- **Not linked, an integration exists:** "Link a barsy venue" with the unlinked ones.
- **No integration:** a sentence and a link to Settings → Integrations.

### 3. Publishing rules move to the venue (CF-04, D73)

- "After a sync: publish automatically / wait until I press Publish" and "New items: show / keep hidden until I review" become **per venue**, in `venues.settings.publish` (`after_sync`, `new_items`), written through a core writer in `core/apply`.
- **Copy, never lose:** a venue without its own value reads the integration's current one, so nothing changes for the demo venue; a save writes the venue's own.
- **Screen:** a "Rules" card in the venue's **Publishing** tab.
- **Worker:** `after-sync.ts` and the new-items handling read the venue's rule. CF-16 publishes every venue on the same catalogue after a changing pull: each must follow **its own** rule.

### 4. Remove the venue's Integration tab

`workspace-tab-defs.ts` loses `integration`; an old link `?tab=integration` opens the venue's Settings tab. Delete the screens and server code that are left unused; move what is reused rather than copying it.

### 5. Words

BG and EN. Follow the vendor-word test (D67, `scripts/vendor-words.baseline.json`): never raise the baseline; reuse how today's integration messages name barsy.

## Tests

- **Component:** each card's states (connected, error, read-only member); the barsy venue list with all four states; the Menu source card in its three cases.
- **Actions (DB):** Add as venue creates exactly one venue and one link; Link refuses a venue that already has one; Not used round-trips; per-venue price and publishing rules write only that venue; the fallback to the integration's old rule.
- **Worker:** two venues on one catalogue with different `after_sync` rules: only the "automatic" one publishes.
- **e2e:** update the integration specs to the new places; one new flow: connect in Settings, Add as venue, choose the category in the new venue, sync. Follow CLAUDE.md's two tiers; DB tests on `restro_cf_09b` (54329).

## Never / scope

- No change to the sync engine beyond reading the venue's publishing rules; no CF-11 switch preview; no new barsy method; never call the live barsy host (fixtures and the fake barsy only).
- No new dependency. Guardrails only tighten (D67). Never read `.env.local`. Files LF.
- Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.

## Report

CLAUDE.md format, at most one page, with screenshot paths (scratchpad `shots/cf-09b/`): Settings → Integrations, the barsy venue list, a venue's Menu source card, the Publishing rules card.
