// Integration tests of the tables-and-QR writers (brief S3-07), as the restro_app role on a real
// Postgres: opaque unique tokens, issue / new code / turn off, names, the "create all" action, the
// venue's QR setting, tenant isolation (row-level security), and that a table barsy deletes loses
// its code at the sync. Skipped without a database (like the other integration tests of this folder).
import { barsyVenues, createPool, type DbPool, places, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { isTableToken, qrAddress, readVenueQr } from '../qr'
import { mapBarsyVenue, type PlaceInput, upsertBarsyVenues, upsertPlaces } from './barsy-venues'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration } from './sources'
import {
  issueAllTableTokens,
  issueTableToken,
  listVenueTables,
  loadTokenFiles,
  retireTableToken,
  setTableLabel,
  setVenueQrSettings,
} from './tables'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { setVenueTheme } from './venue-theme'

const DAY = 24 * 60 * 60 * 1000

describe.skipIf(!hasDatabase)('tables and QR codes (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string
  let otherVenueId: string
  let integrationId: string
  let bid = 100

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-tables-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Tables club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Other tables club' })
    venueId = (
      await provisionVenue(app, tenant, { name: 'Tables Club', slug: testSlug('tables-club') })
    ).id
    otherVenueId = (
      await provisionVenue(app, otherTenant, { name: 'Other', slug: testSlug('other-club') })
    ).id
    integrationId = (await createIntegration(app, tenant, { kind: 'barsy', host: 't.test' })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  const place = (
    id: string,
    num: string | null = id,
    salon: string | null = 'Hall',
  ): PlaceInput => ({
    placeId: id,
    placeNum: num,
    salonName: salon,
    isPublic: true,
  })

  /** A new barsy venue mapped to `venueId`, so each test has tables of its own to work on. */
  async function freshVenue(
    listed: readonly PlaceInput[],
  ): Promise<{ venue: string; bid: number }> {
    bid += 1
    const venue = (
      await provisionVenue(app, tenant, {
        name: `Venue ${bid}`,
        slug: testSlug(`tables-venue-${bid}`),
      })
    ).id
    await upsertBarsyVenues(app, tenant, integrationId, [{ bid, name: `Barsy ${bid}` }])
    expect(await mapBarsyVenue(app, tenant, integrationId, bid, venue)).toMatchObject({ ok: true })
    await upsertPlaces(app, tenant, integrationId, bid, listed, { pagesOk: [true] })
    return { venue, bid }
  }

  const tablesOf = (venue: string) => listVenueTables(app, tenant, venue)
  const byNum = async (venue: string, num: string | null) => {
    const found = (await tablesOf(venue)).find((table) => table.placeNum === num)
    if (!found) throw new Error(`no table ${num}`)
    return found
  }

  describe('issueTableToken, retireTableToken', () => {
    it('gives a table a random opaque code, a different one when asked again, and none on turn-off', async () => {
      const { venue } = await freshVenue([place('9001', '1'), place('9002', '2')])
      const one = await byNum(venue, '1')
      expect(one.token).toBeNull()

      const first = await issueTableToken(app, tenant, one.id)
      if (!first.ok) throw new Error(first.reason)
      expect(first.venueId).toBe(venue)
      expect(first.retired).toBeNull()
      expect(first.table.token).toMatch(/^[0-9A-Za-z]{22}$/)
      expect(isTableToken(first.table.token)).toBe(true)

      const second = await issueTableToken(app, tenant, one.id)
      if (!second.ok) throw new Error(second.reason)
      expect(second.retired).toBe(first.table.token)
      expect(second.table.token).not.toBe(first.table.token)

      const off = await retireTableToken(app, tenant, one.id)
      if (!off.ok) throw new Error(off.reason)
      expect(off.retired).toBe(second.table.token)
      expect(off.table.token).toBeNull()
      // Turning off what is off is not an error and retires nothing.
      expect(await retireTableToken(app, tenant, one.id)).toMatchObject({ ok: true, retired: null })
      expect((await byNum(venue, '1')).token).toBeNull()
    })

    it('property: tokens are unique and never contain a barsy place id or the table id', async () => {
      const seen = new Set<string>()
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.stringMatching(/^[1-9][0-9]{9,11}$/), { minLength: 2, maxLength: 4 }),
          async (placeIds) => {
            const { venue } = await freshVenue(
              placeIds.map((id) => place(id, `T${id.slice(0, 4)}`)),
            )
            const issued = await issueAllTableTokens(app, tenant, venue)
            expect(issued).toMatchObject({ ok: true, issued: placeIds.length })
            const rows = await withTenant(app, tenant, (tx) =>
              tx.select().from(places).where(eq(places.bid, bid)),
            )
            expect(rows).toHaveLength(placeIds.length)
            for (const row of rows) {
              const token = row.qrToken
              expect(token).toMatch(/^[0-9A-Za-z]{22}$/)
              for (const placeId of placeIds) expect(token).not.toContain(placeId)
              expect(token).not.toContain(row.id.slice(3))
              expect(seen.has(token as string)).toBe(false)
              seen.add(token as string)
            }
          },
        ),
        { numRuns: 8 },
      )
    })

    it('refuses a table with no name and no number, until it is given a name', async () => {
      const { venue } = await freshVenue([place('9101', null)])
      const nameless = (await tablesOf(venue))[0]
      if (!nameless) throw new Error('no table')
      expect(await issueTableToken(app, tenant, nameless.id)).toMatchObject({
        ok: false,
        error: 'no_label',
      })
      expect(await setTableLabel(app, tenant, nameless.id, 'Terrace 1')).toMatchObject({ ok: true })
      expect(await issueTableToken(app, tenant, nameless.id)).toMatchObject({ ok: true })
      // The name cannot be taken away again: barsy has no number to fall back on.
      expect(await setTableLabel(app, tenant, nameless.id, null)).toMatchObject({
        ok: false,
        error: 'no_label',
      })
    })

    it('knows no table with a malformed id, another tenant’s id or a deleted table', async () => {
      const { venue } = await freshVenue([place('9201', '1')])
      const mine = await byNum(venue, '1')
      expect(await issueTableToken(app, tenant, 'tb_nope')).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      // Row-level security: the other tenant's pool cannot see this tenant's table.
      expect(await issueTableToken(app, otherTenant, mine.id)).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      expect(await retireTableToken(app, otherTenant, mine.id)).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      expect(await setTableLabel(app, otherTenant, mine.id, 'Hacked')).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      expect((await byNum(venue, '1')).label).toBeNull()
      expect(await listVenueTables(app, otherTenant, venue)).toEqual([])
    })
  })

  describe('setTableLabel', () => {
    it('sets, tidies and clears the name; a name of more than 40 characters is refused', async () => {
      const { venue } = await freshVenue([place('9301', '5')])
      const table = await byNum(venue, '5')
      const set = await setTableLabel(app, tenant, table.id, '  VIP   corner  ')
      expect(set).toMatchObject({ ok: true, retired: null, table: { label: 'VIP corner' } })
      expect(await setTableLabel(app, tenant, table.id, '   ')).toMatchObject({
        ok: true,
        table: { label: null },
      })
      expect(await setTableLabel(app, tenant, table.id, 'x'.repeat(41))).toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
      expect(await setTableLabel(app, tenant, table.id, 'x'.repeat(40))).toMatchObject({ ok: true })
    })
  })

  describe('issueAllTableTokens', () => {
    it('codes the active tables that have none, skips nameless ones and leaves existing codes', async () => {
      const { venue, bid: venueBid } = await freshVenue([
        place('9401', '1'),
        place('9402', '2'),
        place('9403', null),
        place('9404', '4'),
      ])
      const two = await byNum(venue, '2')
      const existing = await issueTableToken(app, tenant, two.id)
      if (!existing.ok) throw new Error(existing.reason)

      // Table 4 goes missing (a complete pull that does not list it): no code for it.
      await upsertPlaces(
        app,
        tenant,
        integrationId,
        venueBid,
        [place('9401', '1'), place('9402', '2'), place('9403', null)],
        { pagesOk: [true] },
      )

      const result = await issueAllTableTokens(app, tenant, venue)
      expect(result).toMatchObject({ ok: true, venueId: venue, issued: 1, skippedNoLabel: 1 })
      const tables = await tablesOf(venue)
      expect(tables.find((table) => table.placeNum === '1')?.token).toMatch(/^[0-9A-Za-z]{22}$/)
      expect(tables.find((table) => table.placeNum === '2')?.token).toBe(existing.table.token)
      expect(tables.find((table) => table.placeNum === null)?.token).toBeNull()
      expect(tables.find((table) => table.placeNum === '4')).toMatchObject({
        state: 'missing',
        token: null,
      })

      // Nothing left to do: asking again changes nothing.
      expect(await issueAllTableTokens(app, tenant, venue)).toMatchObject({
        ok: true,
        issued: 0,
        skippedNoLabel: 1,
      })
    })

    it('refuses a malformed venue id, and a venue of another tenant', async () => {
      expect(await issueAllTableTokens(app, tenant, 'vn_nope')).toMatchObject({
        error: 'invalid_input',
      })
      expect(await issueAllTableTokens(app, tenant, otherVenueId)).toMatchObject({
        ok: false,
        error: 'unknown_venue',
      })
    })
  })

  describe('what the token job writes', () => {
    it('lists the venue’s files: its slug, each code and the table’s name (the manager’s, else barsy’s number)', async () => {
      const { venue } = await freshVenue([
        place('9501', '7'),
        place('9502', '8'),
        place('9503', null),
      ])
      await issueAllTableTokens(app, tenant, venue)
      const eight = await byNum(venue, '8')
      await setTableLabel(app, tenant, eight.id, 'VIP 3')

      const files = await loadTokenFiles(app, tenant, venue)
      expect(files?.venueSlug).toMatch(/^tables-venue-\d+-[0-9a-f]{8}$/)
      // And the venue's public code, which the token files carry to find the venue by (D68).
      expect(files?.venuePublicId).toMatch(/^[a-z0-9]{12}$/)
      expect(files?.files.map((file) => file.tableLabel).sort()).toEqual(['7', 'VIP 3'])
      const seven = await byNum(venue, '7')
      expect(files?.files.find((file) => file.token === seven.token)?.tableLabel).toBe('7')
      expect(await loadTokenFiles(app, otherTenant, venue)).toBeNull()
      expect(await loadTokenFiles(app, tenant, 'vn_nope')).toBeNull()
    })
  })

  describe('a table barsy deletes', () => {
    it('keeps its code while it is only missing, loses it when deleted, and the token comes back to be removed', async () => {
      const { venue, bid: venueBid } = await freshVenue([place('9601', '1'), place('9602', '2')])
      await issueAllTableTokens(app, tenant, venue)
      const two = await byNum(venue, '2')
      const token = two.token as string

      // Not listed in a complete pull: missing; its sticker still works.
      const gone = await upsertPlaces(app, tenant, integrationId, venueBid, [place('9601', '1')], {
        pagesOk: [true],
      })
      expect(gone).toMatchObject({ missing: 1, deleted: 0, retiredTokens: [] })
      expect((await byNum(venue, '2')).token).toBe(token)
      expect((await loadTokenFiles(app, tenant, venue))?.files.map((file) => file.token)).toContain(
        token,
      )

      // A pull with a failed page concludes nothing.
      const failed = await upsertPlaces(app, tenant, integrationId, venueBid, [], {
        pagesOk: [true, false],
        now: new Date(Date.now() + 8 * DAY),
      })
      expect(failed).toMatchObject({ deleted: 0, retiredTokens: [], complete: false })
      expect((await byNum(venue, '2')).token).toBe(token)

      // Still absent after the grace period: deleted, and the token is taken off and reported.
      const late = await upsertPlaces(app, tenant, integrationId, venueBid, [place('9601', '1')], {
        pagesOk: [true],
        now: new Date(Date.now() + 8 * DAY),
      })
      expect(late).toMatchObject({ deleted: 1, retiredTokens: [token] })
      const rows = await withTenant(app, tenant, (tx) =>
        tx.select().from(places).where(eq(places.id, two.id)),
      )
      expect(rows[0]).toMatchObject({ state: 'deleted', qrToken: null })
      expect((await tablesOf(venue)).map((table) => table.placeNum)).toEqual(['1'])
      expect((await loadTokenFiles(app, tenant, venue))?.files).toHaveLength(1)
      expect(await issueTableToken(app, tenant, two.id)).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
    })
  })

  describe('the venue’s QR setting', () => {
    it('saves "our link" with a base address, then the venue’s own pattern, keeping both and the other settings', async () => {
      const { venue } = await freshVenue([])
      // Another setting must survive.
      const colour = await setVenueTheme(app, tenant, {
        venueId: venue as never,
        theme: { brand: '#2563eb', logo_asset_id: null },
      })
      expect(colour?.brand).toBe('#2563eb')

      const ours = await setVenueQrSettings(app, tenant, {
        venueId: venue as never,
        mode: 'ours',
        baseUrl: ' http://192.168.1.20:3000/ ',
        ownPattern: null,
      })
      expect(ours).toEqual({
        ok: true,
        qr: { mode: 'ours', base_url: 'http://192.168.1.20:3000' },
      })

      const own = await setVenueQrSettings(app, tenant, {
        venueId: venue as never,
        mode: 'own',
        baseUrl: 'http://192.168.1.20:3000',
        ownPattern: 'https://menu.club.bg/t/{token}',
      })
      expect(own).toMatchObject({ ok: true, qr: { mode: 'own' } })

      const [row] = await withTenant(app, tenant, (tx) =>
        tx.select().from(venues).where(eq(venues.id, venue)),
      )
      expect(row?.settings).toMatchObject({
        theme: { brand: '#2563eb' },
        qr: {
          mode: 'own',
          base_url: 'http://192.168.1.20:3000',
          own_pattern: 'https://menu.club.bg/t/{token}',
        },
      })
      const resolved = readVenueQr(row?.settings, 'http://localhost:3000')
      expect(qrAddress(resolved, 'Ab3dEfGh1jKlMnOpQrStUv')).toBe(
        'https://menu.club.bg/t/Ab3dEfGh1jKlMnOpQrStUv',
      )

      // Back to ours with the default base address: the pattern is kept.
      const back = await setVenueQrSettings(app, tenant, {
        venueId: venue as never,
        mode: 'ours',
        baseUrl: null,
        ownPattern: 'https://menu.club.bg/t/{token}',
      })
      expect(back).toEqual({
        ok: true,
        qr: { mode: 'ours', own_pattern: 'https://menu.club.bg/t/{token}' },
      })
    })

    it('refuses an unusable address and says which one and why; nothing is saved', async () => {
      const { venue } = await freshVenue([])
      const refused = [
        {
          input: { mode: 'ours', baseUrl: 'club.bg', ownPattern: null },
          field: 'baseUrl',
          problem: 'not_a_url',
        },
        {
          input: { mode: 'ours', baseUrl: 'http://club.bg', ownPattern: null },
          field: 'baseUrl',
          problem: 'not_https',
        },
        {
          input: { mode: 'own', baseUrl: null, ownPattern: 'https://club.bg/t/' },
          field: 'ownPattern',
          problem: 'missing_token',
        },
        {
          input: { mode: 'own', baseUrl: null, ownPattern: 'http://club.bg/t/{token}' },
          field: 'ownPattern',
          problem: 'not_https',
        },
        {
          input: { mode: 'own', baseUrl: null, ownPattern: null },
          field: 'ownPattern',
          problem: 'empty',
        },
      ] as const
      for (const { input, field, problem } of refused) {
        const result = await setVenueQrSettings(app, tenant, { venueId: venue as never, ...input })
        expect(result).toMatchObject({ ok: false, error: 'invalid_input', field, problem })
      }
      const [row] = await withTenant(app, tenant, (tx) =>
        tx.select().from(venues).where(eq(venues.id, venue)),
      )
      expect(row?.settings).not.toHaveProperty('qr')
    })

    it('refuses a malformed venue, an unknown mode and a venue of another tenant', async () => {
      expect(
        await setVenueQrSettings(app, tenant, {
          venueId: 'vn_nope' as never,
          mode: 'ours',
          baseUrl: null,
          ownPattern: null,
        }),
      ).toMatchObject({ ok: false, error: 'invalid_input' })
      expect(
        await setVenueQrSettings(app, tenant, {
          venueId: venueId as never,
          mode: 'sideways' as never,
          baseUrl: null,
          ownPattern: null,
        }),
      ).toMatchObject({ ok: false, error: 'invalid_input' })
      expect(
        await setVenueQrSettings(app, tenant, {
          venueId: otherVenueId as never,
          mode: 'ours',
          baseUrl: null,
          ownPattern: null,
        }),
      ).toMatchObject({ ok: false, error: 'unknown_venue' })
    })
  })

  it('has its places only in its own tenant (row-level security)', async () => {
    const { venue } = await freshVenue([place('9701', '1')])
    const own = await withTenant(app, tenant, (tx) =>
      tx.select().from(barsyVenues).where(eq(barsyVenues.venueId, venue)),
    )
    expect(own).toHaveLength(1)
    const other = await withTenant(app, otherTenant, (tx) =>
      tx
        .select()
        .from(places)
        .where(eq(places.bid, own[0]?.bid ?? -1)),
    )
    expect(other).toEqual([])
  })
})
