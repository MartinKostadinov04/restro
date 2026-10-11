// Integration tests of what the Integration tab (brief S2-05) needs from core: mapping a barsy
// venue to one of our venues, choosing the catalogue root, forgetting both when the host changes,
// and the structured `details` of a job run. As the restro_app role, on a real Postgres.
import {
  barsyVenues,
  createPool,
  type DbPool,
  type JobRunDetails,
  jobRuns,
  withTenant,
} from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import type { ApplyRejection } from './apply'
import {
  clearBarsyVenueChoices,
  mapBarsyVenue,
  setCatalogueRoot,
  setVenuePriceSource,
  upsertBarsyVenues,
} from './barsy-venues'
import { buildJobRunDetails, finishJobRun, MAX_DETAIL_ENTRIES, startJobRun } from './job-runs'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration, updateIntegration } from './sources'
import { readCachedTree, storeCachedTree } from './sync-config'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe('buildJobRunDetails', () => {
  const rejection = (over: Partial<ApplyRejection> = {}): ApplyRejection => ({
    opIndex: 0,
    code: 'price_locked' as ApplyRejection['code'],
    reason: 'the price is barsy’s',
    ...over,
  })

  it('splits notes into lines, scrubs URLs and drops empty lines', () => {
    const details = buildJobRunDetails(
      ['deletion check skipped: 1 page failed\n\nfetched https://x.test/a?key=SECRET', ''],
      [],
    )
    expect(details.notes).toEqual(['deletion check skipped: 1 page failed', 'fetched [url]'])
    expect(JSON.stringify(details)).not.toContain('SECRET')
  })

  it('keeps node, field and code of a refused write, and null for an unknown node', () => {
    const details = buildJobRunDetails(
      [],
      [
        rejection({ nodeRef: 'nd_0123456789ABCDEFGHIJKL', fieldKey: 'price' }),
        rejection({ code: 'unknown_node' }),
      ],
    )
    expect(details.refused).toEqual([
      { nodeRef: 'nd_0123456789ABCDEFGHIJKL', fieldKey: 'price', code: 'price_locked' },
      { nodeRef: null, code: 'unknown_node' },
    ])
  })

  it('holds at most 200 notes and 200 refused writes', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `note ${i}`)
    const refused = Array.from({ length: 300 }, (_, i) => rejection({ opIndex: i }))
    const details = buildJobRunDetails(lines, refused)
    expect(details.notes).toHaveLength(MAX_DETAIL_ENTRIES)
    expect(details.refused).toHaveLength(MAX_DETAIL_ENTRIES)
    expect(details.notes[0]).toBe('note 0')
  })
})

describe.skipIf(!hasDatabase)('the Integration tab’s writers (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let integrationId: string
  let venueA: string
  let venueB: string
  let otherTenantVenue: string

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-integration-writer-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Integration tab club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueA = (await provisionVenue(app, tenant, { name: 'Venue A', slug: testSlug('venue-a') })).id
    venueB = (await provisionVenue(app, tenant, { name: 'Venue B', slug: testSlug('venue-b') })).id
    otherTenantVenue = (
      await provisionVenue(app, otherTenant, { name: 'Elsewhere', slug: testSlug('e') })
    ).id
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 'tab.test' })).id
    await upsertBarsyVenues(app, tenant, integrationId, [
      { bid: 1, name: 'First' },
      { bid: 2, name: 'Second' },
    ])
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  const rowOf = async (bid: number) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(barsyVenues).where(eq(barsyVenues.bid, bid)),
      )
    )[0]

  describe('mapBarsyVenue', () => {
    it('maps a barsy venue to a venue, and again changes nothing', async () => {
      const first = await mapBarsyVenue(app, tenant, integrationId, 1, venueA)
      expect(first).toMatchObject({ ok: true, row: { bid: 1, venueId: venueA } })
      expect(await mapBarsyVenue(app, tenant, integrationId, 1, venueA)).toMatchObject({
        ok: true,
      })
      expect((await rowOf(1))?.venueId).toBe(venueA)
    })

    it('refuses a barsy venue that serves another venue, with a clear code', async () => {
      expect(await mapBarsyVenue(app, tenant, integrationId, 1, venueB)).toEqual({
        ok: false,
        error: 'barsy_venue_taken',
      })
      expect((await rowOf(1))?.venueId).toBe(venueA)
    })

    it('moves a venue to a different barsy venue and frees the old one', async () => {
      const moved = await mapBarsyVenue(app, tenant, integrationId, 2, venueA)
      expect(moved).toMatchObject({ ok: true, row: { bid: 2, venueId: venueA } })
      expect((await rowOf(1))?.venueId).toBeNull()
      // The freed barsy venue can serve another venue now.
      expect(await mapBarsyVenue(app, tenant, integrationId, 1, venueB)).toMatchObject({ ok: true })
    })

    it('says which thing is missing, and never reaches into another tenant', async () => {
      expect(await mapBarsyVenue(app, tenant, integrationId, 99, venueA)).toEqual({
        ok: false,
        error: 'barsy_venue_missing',
      })
      expect(await mapBarsyVenue(app, tenant, integrationId, 2, newId('vn'))).toEqual({
        ok: false,
        error: 'venue_missing',
      })
      expect(await mapBarsyVenue(app, tenant, integrationId, 2, otherTenantVenue)).toEqual({
        ok: false,
        error: 'venue_missing',
      })
      expect(await mapBarsyVenue(app, otherTenant, integrationId, 2, otherTenantVenue)).toEqual({
        ok: false,
        error: 'barsy_venue_missing',
      })
    })

    it('refuses malformed input', async () => {
      await expect(mapBarsyVenue(app, tenant, integrationId, -1, venueA)).rejects.toMatchObject({
        code: 'invalid_input',
      })
      await expect(
        mapBarsyVenue(app, tenant, integrationId, 1, 'not-a-venue'),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })

  describe('setCatalogueRoot', () => {
    it('stores the root, keeps it when the venue is mapped again, and clears it', async () => {
      expect(await setCatalogueRoot(app, tenant, integrationId, 2, 1171)).toMatchObject({
        ok: true,
        row: { catalogueRootCatId: 1171 },
      })
      await mapBarsyVenue(app, tenant, integrationId, 2, venueA)
      expect((await rowOf(2))?.catalogueRootCatId).toBe(1171)
      expect(await setCatalogueRoot(app, tenant, integrationId, 2, null)).toMatchObject({
        ok: true,
        row: { catalogueRootCatId: null },
      })
    })

    it('answers barsy_venue_missing for an unknown venue or another tenant', async () => {
      expect(await setCatalogueRoot(app, tenant, integrationId, 99, 5)).toEqual({
        ok: false,
        error: 'barsy_venue_missing',
      })
      expect(await setCatalogueRoot(app, otherTenant, integrationId, 2, 5)).toEqual({
        ok: false,
        error: 'barsy_venue_missing',
      })
      expect((await rowOf(2))?.catalogueRootCatId).toBeNull()
      await expect(setCatalogueRoot(app, tenant, integrationId, 2, 1.5)).rejects.toMatchObject({
        code: 'invalid_input',
      })
    })
  })

  describe('the catalogue and the price per venue (CF-16)', () => {
    it('records the catalogue barsy reports, and keeps it when a later list says nothing', async () => {
      await upsertBarsyVenues(app, tenant, integrationId, [
        { bid: 1, name: 'First', catalogueId: 72 },
        { bid: 2, name: 'Second', catalogueId: 1 },
      ])
      expect((await rowOf(1))?.catalogueId).toBe(72)
      expect((await rowOf(2))?.catalogueId).toBe(1)
      await upsertBarsyVenues(app, tenant, integrationId, [
        { bid: 1, name: 'First renamed', catalogueId: 70 },
        { bid: 2, name: 'Second' },
      ])
      expect(await rowOf(1)).toMatchObject({ name: 'First renamed', catalogueId: 70 })
      expect((await rowOf(2))?.catalogueId).toBe(1)
      await expect(
        upsertBarsyVenues(app, tenant, integrationId, [{ bid: 1, name: 'x', catalogueId: -1 }]),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('stores the price source of one venue only, and refuses another tenant or a bad value', async () => {
      expect(await setVenuePriceSource(app, tenant, integrationId, 1, 'current_price')).toBe(true)
      expect((await rowOf(1))?.priceSource).toBe('current_price')
      expect((await rowOf(2))?.priceSource).toBeNull()
      expect(await setVenuePriceSource(app, tenant, integrationId, 99, 'actual_price')).toBe(false)
      expect(await setVenuePriceSource(app, otherTenant, integrationId, 1, 'actual_price')).toBe(
        false,
      )
      expect((await rowOf(1))?.priceSource).toBe('current_price')
      await expect(
        setVenuePriceSource(app, tenant, integrationId, 1, 'list_price' as never),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })
  })

  describe('clearBarsyVenueChoices', () => {
    it('forgets the venue and the root of every barsy venue of the integration', async () => {
      await setCatalogueRoot(app, tenant, integrationId, 2, 1171)
      expect(await clearBarsyVenueChoices(app, tenant, integrationId)).toBe(2)
      expect(await rowOf(1)).toMatchObject({ venueId: null, catalogueRootCatId: null })
      expect(await rowOf(2)).toMatchObject({ venueId: null, catalogueRootCatId: null })
      // Another tenant's call touches nothing.
      await mapBarsyVenue(app, tenant, integrationId, 1, venueA)
      expect(await clearBarsyVenueChoices(app, otherTenant, integrationId)).toBe(0)
      expect((await rowOf(1))?.venueId).toBe(venueA)
    })
  })

  describe('updateIntegration config patches', () => {
    it('remove only the named keys and leave the nulls inside other keys alone', async () => {
      await storeCachedTree(app, tenant, integrationId, 1, {
        fetched_at: '2026-10-09T10:00:00.000Z',
        categories: [
          { cat_id: 1, parent_id: null, name: 'Root' },
          { cat_id: 2, parent_id: 1, name: 'Child' },
        ],
      })
      await updateIntegration(app, tenant, integrationId, {
        config: { price_source: 'current_price', allergen_detail_key: 'k1', stale: 1 },
      })
      const updated = await updateIntegration(app, tenant, integrationId, {
        config: { allergen_detail_key: null, stale: null, price_source: 'actual_price' },
      })
      expect(updated?.config).toMatchObject({ price_source: 'actual_price' })
      expect(updated?.config).not.toHaveProperty('allergen_detail_key')
      expect(updated?.config).not.toHaveProperty('stale')
      // The cached tree still reads: its root keeps `parent_id: null`.
      expect(readCachedTree(updated?.config, 1)?.categories[0]).toEqual({
        cat_id: 1,
        parent_id: null,
        name: 'Root',
      })
    })
  })

  describe('finishJobRun details', () => {
    it('stores notes and refused writes as structured details, next to the text', async () => {
      const run = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      await finishJobRun(app, tenant, run.id, {
        status: 'completed',
        summary: 'deletion check skipped: 1 page failed',
        notes: ['photos are fetched in the background'],
        refused: [
          {
            opIndex: 3,
            code: 'less_cautious',
            reason: 'would put the item back on sale',
            nodeRef: 'nd_0123456789ABCDEFGHIJKL',
            fieldKey: 'for_sale',
          },
        ],
      })
      const [stored] = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, run.id)),
      )
      const details = stored?.details as JobRunDetails
      expect(details).toEqual({
        notes: ['deletion check skipped: 1 page failed', 'photos are fetched in the background'],
        refused: [
          { nodeRef: 'nd_0123456789ABCDEFGHIJKL', fieldKey: 'for_sale', code: 'less_cautious' },
        ],
      })
      // The text is still written, for readers of older rows.
      expect(stored?.errorSummary).toContain('deletion check skipped')
      expect(stored?.errorSummary).toContain('1 write refused')
    })

    it('writes deletionCheckSkipped into details when given, and leaves it out otherwise', async () => {
      const skipped = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      await finishJobRun(app, tenant, skipped.id, {
        status: 'completed',
        deletionCheckSkipped: true,
      })
      const [storedSkipped] = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, skipped.id)),
      )
      expect(storedSkipped?.details as JobRunDetails).toMatchObject({ deletionCheckSkipped: true })

      const complete = await startJobRun(app, tenant, { kind: 'barsy_full_pull', integrationId })
      await finishJobRun(app, tenant, complete.id, { status: 'completed' })
      const [storedComplete] = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, complete.id)),
      )
      expect(storedComplete?.details).toEqual({ notes: [], refused: [] })
    })

    it('a run that finishes with nothing to say still has empty details', async () => {
      const run = await startJobRun(app, tenant, { kind: 'barsy_incremental', integrationId })
      await finishJobRun(app, tenant, run.id, { status: 'completed' })
      const [stored] = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, run.id)),
      )
      expect(stored?.details).toEqual({ notes: [], refused: [] })
    })

    it('a run that never finished has no details (older rows look the same)', async () => {
      const run = await startJobRun(app, tenant, { kind: 'asset_fetch', integrationId })
      const [stored] = await withTenant(app, tenant, (tx) =>
        tx.select().from(jobRuns).where(eq(jobRuns.id, run.id)),
      )
      expect(stored?.details).toBeNull()
    })
  })
})
