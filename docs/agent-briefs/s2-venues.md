# Brief S2: the venues list and the new-venue flow (V2, V4)

- **Model:** Sonnet 5.5.
- **Branch:** `ad/s2-venues`, in your own worktree, cut from `ad/05-sync-colours` (it holds ad/01–ad/05). Commit as you go; never push, never merge.
- **Read first (only this):**
  - `CLAUDE.md`, then `docs/decisions.md`. Look up by number in `docs/tracker.md` (search `| D85 |`): D85, D86, D87, D84, D76, D83, D77, D88, D73.
  - `docs/adjustments/adjustments_01.md` → sections **V2, V3 (for the address preview), V4**, and Martin's notes at the end.
  - `docs/platform-reference.md`: port what it names for lists and forms, apply the listed fixes, and say what you ported.
  - The code you own (below) and the interfaces listed under "Interfaces".

## Goal
All venues shows each venue with its state (Draft, Live, Archived), its POS instance (or "By hand"), the venue's name in that POS, and a link to the full menu preview. A venue is created in two steps: the source first (an active POS instance, or by hand), then, from a POS, the instance's venue (nothing typed: name, address and languages come from the till and are editable later), or, by hand, name and languages with an editable address preview. Unpublish takes a venue off guests' phones.

## What the foundation already gives you (ad/01–ad/05; do not redo)
- States: `venueStateOf({ archivedAt, unpublishedAt, livePublished })` in `packages/core/src/venue-state.ts`; `livePublished` = the venue's live menu (`venues.live_menu_id`) has a `publish_pointers` row for it. Unpublish: `unpublishVenueAction` already exists in `apps/web/src/server/venues-actions.ts` (owners and admins; queues the file jobs); you add the button and its confirmation.
- Addresses (D84): the guest address is `/m/<organisation>/<venue>`; build it with `guestMenuPath({ organization, venue })` from `@restro/core`, the organisation's slug from `organizationAddress(pool, tenantId)` (`@restro/core/apply`). A venue's address name must be unique in the organisation and not an old name of another venue: `provisionVenue` throws `ProvisionError('slug_taken')` (the create action already maps it to `taken`).
- From a POS: `addVenueFromTillVenue(pool, tenantId, integrationId, bid, { name, slug, defaultLocale?, enabledLocales? })` (`@restro/core/apply`) makes the venue, its menu and the link in one transaction, refuses a linked till venue (`link_taken`). The instance's venues with their names and links: `barsy_venues` rows (`name`, `venue_id`), read through a loader you add in `apps/web/src/server/venues.ts`; the name of the POS for the card comes from the instance (`integrations.name`), never a hard-coded "barsy".
- Languages of a POS venue (D77): `venueLanguages()` in `packages/core/src/languages.ts` (the owner's plus what the till filled); for a new POS venue pass the instance's `default_locale` as the main language and let the languages follow later syncs. By hand: the form's choice (`LOCALES`).
- Address name from a name: look for an existing slug helper in the web app (grep `slugify` / `toSlug`); if there is none, add `slugFromName(name)` to `packages/core/src/guest-files.ts` (lower-case kebab-case, Bulgarian transliterated, 1–63 chars, with a short unit test).

## Do
1. **All venues** (`app/(admin)/venues/page.tsx`, `venue-card.tsx`): per venue the display name, the state badge (Draft / Live / Archived; archived venues stay in Organisation › Deleted venues, not here), the instance name or "By hand", the POS's venue name when linked, "Open" (the admin), "Preview menu" (the guest address, new tab; disabled with a hint for a Draft). Loader: `listVenueCards(pool, tenantId)` in `apps/web/src/server/venues.ts` (one query set; no N+1 per venue).
2. **New venue in two steps** (`new-venue-dialog.tsx`): step 1 the source: a list of the organisation's active instances (`integrations` with `removed_at is null` if S1 landed that column; else every connected one) and "By hand". Step 2, from a POS: the instance's venues, linked ones shown as "linked to <venue>" and not selectable; pick one and create: nothing typed. By hand: name, languages, and the address preview (`/m/<organisation>/<name as slug>`, editable). The create action (`createVenueAction`, extend it) takes `{ source: { kind: 'instance'; integrationId; bid } | { kind: 'hand' }, name?, slug?, languages? }`.
3. **Unpublish:** on the venue page's danger zone (`venue-danger-zone.tsx`) or the card's menu: "Unpublish" with a confirmation that says what guests will see; calls `unpublishVenueAction`; the state turns Draft.
4. **Wording:** BG + EN through next-intl; `{source}` for the POS name.
5. **Tests:** component tests (card states, the two-step dialog incl. a linked till venue not selectable, Unpublish confirmation), server tests for the loader and the extended create action (both sources; `taken`; RLS), and update `apps/web/e2e/admin.spec.ts` / `venue-lifecycle.spec.ts` where they create venues.

## Interfaces (pinned)
- `listVenueCards(pool, tenantId): Promise<VenueCard[]>` with `VenueCard = { id, name, state: 'draft' | 'live', instanceName: string | null, tillVenueName: string | null, guestPath: string | null }`.
- `createVenueAction(input)` as above; result unchanged in shape (`CreateVenueResult`), plus `error: 'link_taken'` for a till venue already linked.

## Testing (two tiers, CLAUDE.md)
While you work: `pnpm vitest run --project apps/web <paths> --reporter=dot`; database tests need `CI=true` and your own database on the running Postgres 54329 (`createdb restro_s2`, `pnpm db:migrate`, `pnpm db:roles` with `DATABASE_URL_OWNER=postgres://postgres:postgres@localhost:54329/restro_s2`, `DATABASE_URL=postgres://restro_app:local-only-not-a-secret@localhost:54329/restro_s2`, `DATABASE_APP_PASSWORD=local-only-not-a-secret`, `DATABASE_PURGE_PASSWORD=local-only-purge-not-a-secret`). Never touch `restro_accept` or `.env.local`. At the end, once: `pnpm lint && pnpm typecheck && pnpm deps:check`, the vitest projects you touched, and the Playwright specs you changed (`pnpm --filter @restro/web run test:e2e e2e/<spec>.spec.ts --reporter=line`, with `DATABASE_URL*` pointing at your database and `NODE_ENV=development` for the seeds; delete `apps/web/.next/dev/types/validator.ts` first if a stale route type blocks the build). Never run the full suite.

## Never / scope
- Scope: `apps/web/src/components/admin/new-venue-dialog.tsx`, `venue-card.tsx`, `venue-danger-zone.tsx`, `app/(admin)/venues/page.tsx`, `apps/web/src/server/venues.ts`, `venues-actions.ts`, `venues-result.ts`, `apps/web/messages/*.json`, the e2e specs named above, and (only if no helper exists) `slugFromName` in core. Nothing else without asking; S1 owns the Integrations screen, S3 the Deleted venues list and Organisation › General.
- No POS call from the web app; no new dependency; no schema change.
- Secrets: never read `.env.local`.
- Report as in `docs/agent-briefs/_template.md`, at most a page, in your final message.
