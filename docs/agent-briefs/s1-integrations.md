# Brief S1: the Integrations screen, source-agnostic (I1, I2, B2, B6)

- **Model:** Sonnet 5.5.
- **Branch:** `ad/s1-integrations`, in your own worktree, cut from `ad/05-sync-colours` (it holds ad/01–ad/05). Commit as you go; never push, never merge.
- **Read first (only this; the big documents are for looking things up):**
  - `CLAUDE.md`, then `docs/decisions.md`. Look up by number in `docs/tracker.md` (search `| D81 |`): D81, D82, D73, D67, D88, D91 (point 10), D77, D83, D91 (point 2).
  - `docs/adjustments/adjustments_01.md` → sections **I1, I2, B2, B6**, and **3. barsy connector** for what stays barsy's. Martin's notes at the end.
  - `docs/platform-reference.md`: port the Platform's settings/integration patterns it names, apply the listed fixes, and say what you ported.
  - The code you own (below) and the core/db interfaces listed under "Interfaces".

## Goal
Settings › Integrations knows no POS. An organisation picks its systems; each chosen system gets a tab; inside it, named instances ("barsy – Sofia") each with their connection form, status, that system's own settings, "Sync everything now" and a collapsed run history. The Till venues card goes (S2's new-venue flow replaces it). A venue's Menu source card has a common part for every POS venue and a part supplied by the connector, shown only for its venues. Every text names the POS with `{source}`; "barsy" appears only in the barsy tab's own files.

## What the foundation already gives you (ad/01–ad/05; do not redo)
- `integrations.name` (NOT NULL; backfilled "barsy – <host>"; a BEFORE INSERT trigger names a nameless row): `createIntegration(pool, tenantId, { kind, host, name? })`, `updateIntegration(...)` in `packages/core/src/apply/sources.ts`.
- `tenants.settings.systems: string[]` (jsonb, backfilled from the existing rows). There is no writer yet: add `setOrganizationSystems(pool, tenantId, systems)` in `packages/core/src/apply/organization.ts` (strict Zod on the known system kinds, refuse unselecting a system that still has instances: error `has_instances`).
- `integrations.config.default_locale` stays an instance setting (D82). The sync schedule and the rollback pause have MOVED to the venue (ad/05: `venues.settings.sync`, `venues.settings.publish.auto_paused`); the instance's `config.schedule` is only a fallback for venues that never saved their own. **Do not build the schedule form on the instance any more**; S4 builds the venue's Automation settings. Keep "Sync everything now" and the run history on the instance.
- A venue's source is fixed at creation (D87): no "Change…" or re-link anywhere; the old picker/relink controls go. `mapBarsyVenue` stays for S2's new-venue flow only.
- The barsy roots are the till's (D88): no category picker; delete `category-picker.tsx` and its tests.

## Do
1. **Systems picker** (`apps/web/src/integration/systems-picker.tsx` or similar): the known systems come from one registry in `apps/web/src/connectors/` (today: barsy; the list is the connectors folder's, so the platform file never names a POS). Saving calls `setOrganizationSystems`. Unselecting a system that has instances is refused with a sentence.
2. **One tab per chosen system**, each listing its instances with "Add {source}". An instance panel: connection card (host, API user, password, name), status card, the **system settings card supplied by the connector** (barsy: allergen characteristic, language of untagged text `default_locale`; nothing else), "Sync everything now", and the run history **collapsed** (one line with the last run; the list opens under a dropdown, D82).
3. **Instance removal:** add migration `packages/db/migrations/0027_integrations_removed_at.sql` (via `pnpm db:generate --name=integrations_removed_at`): `integrations.removed_at timestamptz` nullable. A removed instance is hidden from the screen, never synced (add `isNull(integrations.removedAt)` to the worker's `syncTargets` in `apps/worker/src/jobs/barsy.ts` and to every place the web lists instances), and removing is refused while venues link to it (`barsy_venues.venue_id` not null for that instance): error `has_venues`. The row and its credentials are never erased (D91 point 2's purge is a later lead task). Writer: `removeIntegration(pool, tenantId, integrationId)` in `packages/core/src/apply/sources.ts`.
4. **The venue's Menu source card** (`apps/web/src/integration/menu-source-card.tsx` and `apps/web/src/server/integration/**`): the common part (instance name and till venue name, "Sync this venue", collapsed history, held-sync warning) and the connector part (barsy: "Price shown", Base `actual_price` default vs Current `current_price` with the Q43 warning, D91 point 10; it calls `setVenuePriceSource`). A hand-made venue (no till link) shows neither. The "Change…" step, the mapping card and the catalogue root go.
5. **Wording:** every string through next-intl, BG + EN, with `{source}` for the POS name. Run `pnpm vendor-words:baseline` after you remove "barsy" from platform files; the baseline may only go down.
6. **Tests:** component tests for the picker, an instance panel and the Menu source card (both parts); server tests for the writers (refusals `has_instances`, `has_venues`; RLS); update `apps/web/e2e/integration.spec.ts` to the new screen (keep what it proves: connect, status, sync everything, history).

## Interfaces (pinned)
- `setOrganizationSystems(pool, tenantId, systems: readonly string[]): Promise<{ ok: true; systems } | { ok: false; error: 'invalid_input' | 'has_instances' }>`.
- `removeIntegration(pool, tenantId, integrationId): Promise<{ ok: true } | { ok: false; error: 'unknown_integration' | 'has_venues' }>`.
- Read the system list and each connector's settings card from `apps/web/src/connectors/` (the only web folder that may name a POS, `scripts/vendor-words.config.ts`).

## Testing (two tiers, CLAUDE.md)
While you work: `pnpm vitest run --project apps/web <paths> --reporter=dot` and `--project packages/core <paths>`; database tests need `CI=true` and your own database on the running Postgres 54329 (`createdb restro_s1`, `pnpm db:migrate`, `pnpm db:roles` with `DATABASE_URL_OWNER=postgres://postgres:postgres@localhost:54329/restro_s1`, `DATABASE_URL=postgres://restro_app:local-only-not-a-secret@localhost:54329/restro_s1`, `DATABASE_APP_PASSWORD=local-only-not-a-secret`, `DATABASE_PURGE_PASSWORD=local-only-purge-not-a-secret`). Never touch `restro_accept` or `.env.local`. At the end, once: `pnpm lint && pnpm typecheck && pnpm deps:check`, the vitest projects you touched, and `pnpm --filter @restro/web run test:e2e e2e/integration.spec.ts --reporter=line` (set `DATABASE_URL*` to your database and `NODE_ENV=development` for the seeds; delete `apps/web/.next/dev/types/validator.ts` first if a stale route type blocks the build). Never run the full suite.

## Never / scope
- Scope: `apps/web/src/integration/**`, `apps/web/src/connectors/**`, `apps/web/app/(admin)/settings/integrations/**`, `apps/web/src/server/integration/**`, `apps/web/messages/*.json`, the two core writers above, one migration, the one-line worker filter, `scripts/vendor-words.baseline.json` (down only). Nothing else without asking.
- No POS call from the web app; no new dependency; no change to `apply()`, the sync, the publish or the schema beyond the one column.
- Secrets: never read `.env.local`.
- Report as in `docs/agent-briefs/_template.md`, at most a page, in your final message.
