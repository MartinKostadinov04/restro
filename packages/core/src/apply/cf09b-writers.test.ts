// The writers CF-09b adds, as the restro_app role on a real Postgres: "Add as venue" (one venue,
// its menu and the link in one transaction), linking only a venue that has no link yet, the "Not
// used" set, the venue's own publishing rules, and the venue a job run was for.
import {
  barsyVenues,
  createPool,
  type DbPool,
  integrations,
  jobRuns,
  menus,
  venues,
  withTenant,
} from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { venueHoldsNewItems, venueOwnPublishRules, venuePublishesAfterSync } from '../sync-settings'
import { addVenueFromTillVenue, mapBarsyVenue, upsertBarsyVenues } from './barsy-venues'
import { finishJobRun, startJobRun } from './job-runs'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration, updateIntegration } from './sources'
import { readNotUsedVenues, setTillVenueNotUsed } from './sync-config'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { setVenuePublishRules } from './venue-publish-rules'

describe.skipIf(!hasDatabase)('the writers of CF-09b (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let integrationId: string
  let venueA: string
  let venueB: string
  let otherTenantVenue: string

  const venuesOf = (tenantId: string) =>
    withTenant(app, tenantId, (tx) => tx.select().from(venues).orderBy(venues.createdAt))
  const linkRow = async (bid: number) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(barsyVenues).where(eq(barsyVenues.bid, bid)),
      )
    )[0]
  const configOf = async () =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, integrationId)),
      )
    )[0]?.config as Record<string, unknown>
  const settingsOf = async (tenantId: string, venueId: string) =>
    (
      await withTenant(app, tenantId, (tx) =>
        tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
      )
    )[0]?.settings

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-cf09b-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'CF-09b club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'cf09b.test' })).id
    await upsertBarsyVenues(app, tenant, integrationId, [
      { bid: 1, name: 'Main bar' },
      { bid: 2, name: 'Roof terrace' },
      { bid: 3, name: 'Shop' },
      { bid: 4, name: 'Cellar' },
    ])
    venueA = (await provisionVenue(app, tenant, { name: 'Venue A', slug: testSlug('a') })).id
    venueB = (await provisionVenue(app, tenant, { name: 'Venue B', slug: testSlug('b') })).id
    otherTenantVenue = (
      await provisionVenue(app, otherTenant, { name: 'Other venue', slug: testSlug('other') })
    ).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  describe('addVenueFromTillVenue ("Add as venue")', () => {
    it('makes exactly one venue, its menu and the link, and returns the venue', async () => {
      const before = (await venuesOf(tenant)).length
      const result = await addVenueFromTillVenue(app, tenant, integrationId, 1, {
        name: 'Main bar',
        slug: testSlug('main-bar'),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const after = await venuesOf(tenant)
      expect(after).toHaveLength(before + 1)
      expect(result.venue).toMatchObject({
        name: 'Main bar',
        timezone: 'Europe/Sofia',
        currency: 'EUR',
        defaultLocale: 'bg_BG',
      })
      expect(result.venue.publicId).toMatch(/^[a-z0-9]{12}$/)
      expect(await linkRow(1)).toMatchObject({ venueId: result.venue.id })
      const menuRows = await withTenant(app, tenant, (tx) =>
        tx.select().from(menus).where(eq(menus.venueId, result.venue.id)),
      )
      expect(menuRows).toHaveLength(1)
    })

    it('a second request for the same till venue makes no second venue', async () => {
      const before = (await venuesOf(tenant)).length
      const again = await addVenueFromTillVenue(app, tenant, integrationId, 1, {
        name: 'Main bar',
        slug: testSlug('main-bar-again'),
      })
      expect(again).toEqual({ ok: false, error: 'link_taken' })
      expect(await venuesOf(tenant)).toHaveLength(before)
    })

    it('two requests at the same time make one venue (the tenant lock serialises them)', async () => {
      const before = (await venuesOf(tenant)).length
      const results = await Promise.all([
        addVenueFromTillVenue(app, tenant, integrationId, 2, {
          name: 'Roof terrace',
          slug: testSlug('roof'),
        }),
        addVenueFromTillVenue(app, tenant, integrationId, 2, {
          name: 'Roof terrace',
          slug: testSlug('roof'),
        }),
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'link_taken' }])
      expect(await venuesOf(tenant)).toHaveLength(before + 1)
    })

    it('refuses an unknown till venue and another organisation’s, and makes nothing', async () => {
      const before = (await venuesOf(tenant)).length
      expect(
        await addVenueFromTillVenue(app, tenant, integrationId, 99, {
          name: 'Ghost',
          slug: testSlug('ghost'),
        }),
      ).toEqual({ ok: false, error: 'link_missing' })
      expect(
        await addVenueFromTillVenue(app, otherTenant, integrationId, 3, {
          name: 'Stolen',
          slug: testSlug('stolen'),
        }),
      ).toEqual({ ok: false, error: 'link_missing' })
      expect(await venuesOf(tenant)).toHaveLength(before)
      expect(await venuesOf(otherTenant)).toHaveLength(1)
      expect((await linkRow(3))?.venueId).toBeNull()
    })

    it('a bad name or address makes no venue and leaves the till venue free', async () => {
      const before = (await venuesOf(tenant)).length
      await expect(
        addVenueFromTillVenue(app, tenant, integrationId, 3, { name: '  ', slug: 'shop' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(
        addVenueFromTillVenue(app, tenant, integrationId, 3, { name: 'Shop', slug: 'Not A Slug' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
      expect(await venuesOf(tenant)).toHaveLength(before)
      expect((await linkRow(3))?.venueId).toBeNull()
    })
  })

  describe('mapBarsyVenue with venueMustBeUnlinked ("Link to an existing venue")', () => {
    it('refuses a venue that already has a link, and changes nothing', async () => {
      expect(await mapBarsyVenue(app, tenant, integrationId, 3, venueA)).toMatchObject({ ok: true })
      const refused = await mapBarsyVenue(app, tenant, integrationId, 4, venueA, {
        venueMustBeUnlinked: true,
      })
      expect(refused).toEqual({ ok: false, error: 'venue_already_linked' })
      expect((await linkRow(3))?.venueId).toBe(venueA)
      expect((await linkRow(4))?.venueId).toBeNull()
    })

    it('links a venue that has none, and refuses a till venue another venue holds', async () => {
      expect(
        await mapBarsyVenue(app, tenant, integrationId, 4, venueB, { venueMustBeUnlinked: true }),
      ).toMatchObject({ ok: true })
      expect((await linkRow(4))?.venueId).toBe(venueB)
      expect(
        await mapBarsyVenue(app, tenant, integrationId, 4, venueA, { venueMustBeUnlinked: true }),
      ).toEqual({ ok: false, error: 'barsy_venue_taken' })
      expect((await linkRow(4))?.venueId).toBe(venueB)
    })

    it('without the option a deliberate change still moves the venue and frees the old one', async () => {
      // Venue A serves till venue 3; the Menu source card's "Change…" moves it to a free one.
      await upsertBarsyVenues(app, tenant, integrationId, [{ bid: 5, name: 'Terrace 2' }])
      expect((await linkRow(3))?.venueId).toBe(venueA)
      await mapBarsyVenue(app, tenant, integrationId, 5, venueA)
      expect((await linkRow(5))?.venueId).toBe(venueA)
      expect((await linkRow(3))?.venueId).toBeNull()
    })
  })

  describe('"Not used" (config.not_used)', () => {
    it('round-trips, one till venue at a time, and keeps every other key', async () => {
      await updateIntegration(app, tenant, integrationId, {
        config: { price_source: 'current_price' },
      })
      expect(readNotUsedVenues(await configOf())).toEqual(new Set())

      expect(await setTillVenueNotUsed(app, tenant, integrationId, 3, true)).toBe(true)
      expect(await setTillVenueNotUsed(app, tenant, integrationId, 3, true)).toBe(true)
      expect(await setTillVenueNotUsed(app, tenant, integrationId, 7, true)).toBe(true)
      expect(readNotUsedVenues(await configOf())).toEqual(new Set([3, 7]))
      expect((await configOf()).price_source).toBe('current_price')

      expect(await setTillVenueNotUsed(app, tenant, integrationId, 3, false)).toBe(true)
      expect(readNotUsedVenues(await configOf())).toEqual(new Set([7]))
      expect(await setTillVenueNotUsed(app, tenant, integrationId, 3, false)).toBe(true)
      expect(await setTillVenueNotUsed(app, tenant, integrationId, 7, false)).toBe(true)
      expect(readNotUsedVenues(await configOf())).toEqual(new Set())
    })

    it('reads junk as empty, replaces a stored value that is not an object, and checks input', async () => {
      for (const junk of [null, undefined, 'x', 3, [], { not_used: 'x' }, { not_used: { a: 1 } }]) {
        expect(readNotUsedVenues(junk)).toEqual(new Set())
      }
      await updateIntegration(app, tenant, integrationId, { config: { not_used: 'broken' } })
      expect(await setTillVenueNotUsed(app, tenant, integrationId, 5, true)).toBe(true)
      expect((await configOf()).not_used).toEqual({ '5': true })
      expect(await setTillVenueNotUsed(app, tenant, newId('in'), 5, true)).toBe(false)
      expect(await setTillVenueNotUsed(app, otherTenant, integrationId, 5, true)).toBe(false)
      await expect(setTillVenueNotUsed(app, tenant, integrationId, -1, true)).rejects.toMatchObject(
        { code: 'invalid_input' },
      )
      await setTillVenueNotUsed(app, tenant, integrationId, 5, false)
    })
  })

  describe('setVenuePublishRules (the venue’s Rules card)', () => {
    it('writes only that venue’s rules, and keeps the other keys of its settings', async () => {
      await owner.query(`update restro.venues set settings = $2::jsonb where id = $1`, [
        venueA,
        JSON.stringify({ theme: { logo_asset_id: null }, guest_features: { bill: true } }),
      ])
      const bBefore = await settingsOf(tenant, venueB)

      const saved = await setVenuePublishRules(app, tenant, {
        venueId: venueA,
        rules: { after_sync: 'manual', new_items: 'hold' },
      })
      expect(saved).toEqual({ after_sync: 'manual', new_items: 'hold' })
      expect(await settingsOf(tenant, venueA)).toEqual({
        theme: { logo_asset_id: null },
        guest_features: { bill: true },
        publish: { after_sync: 'manual', new_items: 'hold' },
      })
      expect(await settingsOf(tenant, venueB)).toEqual(bBefore)
    })

    it('a save writes both rules, replaces the old ones, keeps the pause (T76) and is idempotent', async () => {
      // The pause after a return sits next to the rules (ad/05): a save of the rules keeps it.
      await owner.query(
        `update restro.venues
         set settings = settings || '{"publish": {"after_sync": "manual", "new_items": "hold", "auto_paused": true}}'::jsonb
         where id = $1`,
        [venueA],
      )
      await setVenuePublishRules(app, tenant, {
        venueId: venueA,
        rules: { after_sync: 'auto', new_items: 'show' },
      })
      await setVenuePublishRules(app, tenant, {
        venueId: venueA,
        rules: { after_sync: 'auto', new_items: 'show' },
      })
      const settings = await settingsOf(tenant, venueA)
      expect((settings as { publish: unknown }).publish).toEqual({
        after_sync: 'auto',
        new_items: 'show',
        auto_paused: true,
      })
    })

    it('a venue without rules of its own follows the integration, one with them does not', async () => {
      await updateIntegration(app, tenant, integrationId, {
        config: { publish: { after_sync: 'manual', new_items: 'hold' } },
      })
      const config = await configOf()
      // Venue B never saved: it reads the integration's rule. Venue A saved 'auto', 'show'.
      expect(venuePublishesAfterSync(await settingsOf(tenant, venueB), config)).toBe(false)
      // The new-items rule is retired (D96): a stored `hold` holds nothing.
      expect(venueHoldsNewItems(await settingsOf(tenant, venueB), config)).toBe(false)
      expect(venuePublishesAfterSync(await settingsOf(tenant, venueA), config)).toBe(true)
      expect(venueHoldsNewItems(await settingsOf(tenant, venueA), config)).toBe(false)

      // Saving B writes B's own; A and the integration are untouched.
      await setVenuePublishRules(app, tenant, {
        venueId: venueB,
        rules: { after_sync: 'auto', new_items: 'hold' },
      })
      expect(venueOwnPublishRules(await settingsOf(tenant, venueB))).toEqual({
        after_sync: 'auto',
        new_items: 'hold',
      })
      expect((await configOf()).publish).toEqual({ after_sync: 'manual', new_items: 'hold' })
      expect(venueOwnPublishRules(await settingsOf(tenant, venueA))).toEqual({
        after_sync: 'auto',
        new_items: 'show',
      })
    })

    it('refuses an unknown venue, another organisation’s venue and bad input', async () => {
      const rules = { after_sync: 'manual', new_items: 'hold' } as const
      await expect(
        setVenuePublishRules(app, tenant, { venueId: newId('vn'), rules }),
      ).rejects.toMatchObject({ code: 'venue_missing' })
      await expect(
        setVenuePublishRules(app, tenant, { venueId: otherTenantVenue, rules }),
      ).rejects.toMatchObject({ code: 'venue_missing' })
      expect(await settingsOf(otherTenant, otherTenantVenue)).toEqual({})
      for (const bad of [
        { venueId: venueA, rules: { after_sync: 'later', new_items: 'hold' } },
        { venueId: venueA, rules: { ...rules, auto_paused: true } },
        { venueId: 'nope', rules },
      ]) {
        await expect(
          setVenuePublishRules(app, tenant, bad as never),
          JSON.stringify(bad),
        ).rejects.toMatchObject({ code: 'invalid_input' })
      }
    })
  })

  describe('the venue of a job run', () => {
    it('is kept in details.venue_id from the start to the finish', async () => {
      const run = await startJobRun(app, tenant, {
        kind: 'barsy_full_pull',
        integrationId,
        venueId: venueA,
      })
      expect(run.details).toEqual({ notes: [], refused: [], venue_id: venueA })
      const finished = await finishJobRun(app, tenant, run.id, {
        status: 'completed',
        counters: { created: 1 },
        venueId: venueA,
      })
      expect(finished?.details?.venue_id).toBe(venueA)
    })

    it('a run with no venue has no details until it finishes, as before', async () => {
      const run = await startJobRun(app, tenant, { kind: 'barsy_connect', integrationId })
      expect(run.details).toBeNull()
      const finished = await finishJobRun(app, tenant, run.id, { status: 'completed' })
      expect(finished?.details).toEqual({ notes: [], refused: [] })
      const rows = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, run.id)),
      )
      expect(rows[0]?.details).not.toHaveProperty('venue_id')
    })

    it('refuses a venue id that is not one', async () => {
      await expect(
        startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId, venueId: 'nope' }),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })
})
