// Integration tests of the areas-and-tables writers (D95; brief S3-07), as the restro_app role on
// a real Postgres: a till venue's places mirrored into areas and tables (keys, order, hidden by
// default, the till's changes against the manager's, deletion, linking), opaque unique tokens,
// issue / new code / turn off, names, hiding and moving, the "create all" action, the owner's own
// areas and tables on a venue without a till, the venue's QR setting and tenant isolation
// (row-level security). Skipped without a database (like the other integration tests here).
import { createPool, type DbPool, places, venues, venueTables, withTenant } from '@restro/db'
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
  createArea,
  createTable,
  deleteArea,
  deleteTable,
  issueAllTableTokens,
  issueTableToken,
  listVenueAreas,
  listVenueTables,
  loadTokenFiles,
  moveArea,
  moveTable,
  renameArea,
  retireTableToken,
  setAreaHidden,
  setTableHidden,
  setTableName,
  setTableNumber,
  setVenueQrSettings,
} from './tables'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { setVenueTheme } from './venue-theme'

const DAY = 24 * 60 * 60 * 1000
const TOKEN = /^[0-9A-Za-z]{22}$/

describe.skipIf(!hasDatabase)('areas, tables and QR codes (as the restro_app role)', () => {
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
    extra: Partial<PlaceInput> = {},
  ): PlaceInput => ({
    placeId: id,
    placeNum: num,
    salonName: salon,
    isPublic: true,
    ...extra,
  })

  /** A new till venue mapped to a new venue, with its places read: tables of its own per test. */
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

  const pull = (venueBid: number, listed: readonly PlaceInput[], now?: Date) =>
    upsertPlaces(app, tenant, integrationId, venueBid, listed, {
      pagesOk: [true],
      ...(now === undefined ? {} : { now }),
    })
  const tablesOf = (venue: string) => listVenueTables(app, tenant, venue)
  const areasOf = (venue: string) => listVenueAreas(app, tenant, venue)
  const byNum = async (venue: string, num: string | null) => {
    const found = (await tablesOf(venue)).find((table) => table.number === num)
    if (!found) throw new Error(`no table ${num}`)
    return found
  }
  const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`)
    return result as Extract<T, { ok: true }>
  }

  describe('the mirror: a till venue’s places become the venue’s areas and tables', () => {
    it('makes an area per hall (keyed by the till’s hall id, in its order, no hall last) and a table per place, numbers in order', async () => {
      const { venue } = await freshVenue([
        place('1', '10', 'Terrace', { salonId: '7', salonWeight: 2 }),
        place('2', '2', 'Terrace', { salonId: '7', salonWeight: 2 }),
        place('3', 'VIP', 'Main', { salonId: '5', salonWeight: 1 }),
        place('4', '4', 'Main', { salonId: '5', salonWeight: 1, isPublic: false }),
        place('5', '--', 'Main', { salonId: '5', salonWeight: 1 }),
        place('6', null, 'Main', { salonId: '5', salonWeight: 1 }),
        place('7', '1', null),
        place('8', '8', 'Garden'),
      ])
      const areas = await areasOf(venue)
      expect(areas.map((area) => [area.name, area.fromTill, area.hidden])).toEqual([
        ['Main', true, false],
        ['Terrace', true, false],
        ['Garden', true, false],
        ['Tables', true, false],
      ])
      const tables = await tablesOf(venue)
      const byArea = (name: string) =>
        tables.filter((table) => table.areaId === areas.find((area) => area.name === name)?.id)
      expect(byArea('Main').map((table) => [table.number, table.hidden, table.name])).toEqual([
        ['4', true, null], // not public: hidden by default (D95)
        ['--', true, null], // a placeholder: hidden
        ['VIP', false, null],
        ['—', true, null], // no number at all: hidden until it is named and shown
      ])
      expect(byArea('Terrace').map((table) => table.number)).toEqual(['2', '10'])
      expect(byArea('Garden').map((table) => table.number)).toEqual(['8'])
      expect(byArea('Tables').map((table) => table.number)).toEqual(['1'])
      expect(tables.every((table) => TOKEN.test(table.id.slice(3)) && table.token === null)).toBe(
        true,
      )
      // Each place points at its table.
      const rows = await withTenant(app, tenant, (tx) =>
        tx.select({ tableId: places.tableId }).from(places).where(eq(places.bid, bid)),
      )
      expect(rows.map((row) => row.tableId).sort()).toEqual(tables.map((t) => t.id).sort())
    })

    it('a renamed hall keeps its area and the manager’s name; a moved place moves its table; the manager’s order and hidden flag survive a pull; the number follows the till', async () => {
      const listed = [
        place('1', '1', 'Main', { salonId: '5', salonWeight: 1 }),
        place('2', '2', 'Main', { salonId: '5', salonWeight: 1 }),
        place('3', '3', 'Main', { salonId: '5', salonWeight: 1, isPublic: false }),
      ]
      const { venue, bid: venueBid } = await freshVenue(listed)
      const [main] = await areasOf(venue)
      if (!main) throw new Error('no area')
      ok(await renameArea(app, tenant, main.id, 'Ground floor'))
      const three = await byNum(venue, '3')
      ok(await setTableHidden(app, tenant, three.id, false))
      ok(await setTableName(app, tenant, three.id, 'Corner'))
      ok(await moveTable(app, tenant, { tableId: three.id, areaId: main.id, after: null }))

      // The till renames the hall, moves table 2 to a new hall and renumbers table 3.
      await pull(venueBid, [
        place('1', '1', 'Main floor', { salonId: '5', salonWeight: 2 }),
        place('2', '2', 'Upstairs', { salonId: '9', salonWeight: 1 }),
        place('3', '33', 'Main floor', { salonId: '5', salonWeight: 2, isPublic: false }),
      ])
      const areas = await areasOf(venue)
      expect(areas.map((area) => area.name)).toEqual(['Ground floor', 'Upstairs'])
      expect(areas[0]?.id).toBe(main.id)
      const tables = await tablesOf(venue)
      expect(tables.map((table) => [table.number, table.areaId === main.id])).toEqual([
        ['33', true],
        ['1', true],
        ['2', false],
      ])
      expect(tables[0]).toMatchObject({ id: three.id, name: 'Corner', hidden: false })
      // The area the till made for "Upstairs" is ordered first by the till's weight, but the
      // existing areas keep the order the manager knows: new areas are added after them.
      expect(areas.map((area) => area.fromTill)).toEqual([true, true])
    })

    it('links: places read before the venue existed become its tables when the till venue is mapped', async () => {
      bid += 1
      await upsertBarsyVenues(app, tenant, integrationId, [{ bid, name: `Barsy ${bid}` }])
      await pull(bid, [place('1', '1'), place('2', '2')])
      const venue = (
        await provisionVenue(app, tenant, { name: 'Late', slug: testSlug(`late-${bid}`) })
      ).id
      expect(await tablesOf(venue)).toEqual([])
      ok(await mapBarsyVenue(app, tenant, integrationId, bid, venue))
      expect((await tablesOf(venue)).map((table) => table.number)).toEqual(['1', '2'])
    })
  })

  describe('issueTableToken, retireTableToken', () => {
    it('gives a table a random opaque code, a different one when asked again, and none on turn-off', async () => {
      const { venue } = await freshVenue([place('9001', '1'), place('9002', '2')])
      const one = await byNum(venue, '1')
      expect(one.token).toBeNull()

      const first = ok(await issueTableToken(app, tenant, one.id))
      expect(first.venueId).toBe(venue)
      expect(first.retired).toBeNull()
      expect(first.table.token).toMatch(TOKEN)
      expect(isTableToken(first.table.token)).toBe(true)

      const second = ok(await issueTableToken(app, tenant, one.id))
      expect(second.retired).toBe(first.table.token)
      expect(second.table.token).not.toBe(first.table.token)

      const off = ok(await retireTableToken(app, tenant, one.id))
      expect(off.retired).toBe(second.table.token)
      expect(off.table.token).toBeNull()
      // Turning off what is off is not an error and retires nothing.
      expect(await retireTableToken(app, tenant, one.id)).toMatchObject({ ok: true, retired: null })
      expect((await byNum(venue, '1')).token).toBeNull()
    })

    it('property: tokens are unique and never contain a till place id or the table id', async () => {
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
              tx.select().from(venueTables).where(eq(venueTables.venueId, venue)),
            )
            expect(rows).toHaveLength(placeIds.length)
            for (const row of rows) {
              const token = row.qrToken
              expect(token).toMatch(TOKEN)
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

    it('refuses a hidden table and a table of a hidden area, until they are shown', async () => {
      const { venue } = await freshVenue([
        place('9101', '1', 'Hall', { isPublic: false }),
        place('9102', '2', 'Back room'),
      ])
      const one = await byNum(venue, '1')
      expect(one.hidden).toBe(true)
      expect(await issueTableToken(app, tenant, one.id)).toMatchObject({
        ok: false,
        error: 'hidden',
      })
      ok(await setTableHidden(app, tenant, one.id, false))
      expect(await issueTableToken(app, tenant, one.id)).toMatchObject({ ok: true })

      const two = await byNum(venue, '2')
      const back = (await areasOf(venue)).find((area) => area.id === two.areaId)
      if (!back) throw new Error('no area')
      const hiddenArea = ok(await setAreaHidden(app, tenant, back.id, true))
      expect(hiddenArea.area.hidden).toBe(true)
      expect(await issueTableToken(app, tenant, two.id)).toMatchObject({
        ok: false,
        error: 'hidden',
      })
      ok(await setAreaHidden(app, tenant, back.id, false))
      expect(await issueTableToken(app, tenant, two.id)).toMatchObject({ ok: true })
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
      expect(await setTableName(app, otherTenant, mine.id, 'Hacked')).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      expect((await byNum(venue, '1')).name).toBeNull()
      expect(await listVenueTables(app, otherTenant, venue)).toEqual([])
      expect(await listVenueAreas(app, otherTenant, venue)).toEqual([])
    })
  })

  describe('setTableName', () => {
    it('sets, tidies and clears the name; a name of more than 40 characters is refused', async () => {
      const { venue } = await freshVenue([place('9301', '5')])
      const table = await byNum(venue, '5')
      const set = await setTableName(app, tenant, table.id, '  VIP   corner  ')
      expect(set).toMatchObject({ ok: true, retired: null, table: { name: 'VIP corner' } })
      expect(await setTableName(app, tenant, table.id, '   ')).toMatchObject({
        ok: true,
        table: { name: null },
      })
      expect(await setTableName(app, tenant, table.id, 'x'.repeat(41))).toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
      expect(await setTableName(app, tenant, table.id, 'x'.repeat(40))).toMatchObject({ ok: true })
      // The number is the till's: not for the manager to change on a till venue.
      expect(await setTableNumber(app, tenant, table.id, '6')).toMatchObject({
        ok: false,
        error: 'from_till',
      })
    })
  })

  describe('setTableHidden, moveTable, moveArea', () => {
    it('hiding keeps the token but names it for removal; showing brings the file back', async () => {
      const { venue } = await freshVenue([place('9321', '1')])
      const one = await byNum(venue, '1')
      const issued = ok(await issueTableToken(app, tenant, one.id))
      const token = issued.table.token as string
      const hidden = ok(await setTableHidden(app, tenant, one.id, true))
      expect(hidden).toMatchObject({ retired: token, table: { hidden: true, token } })
      expect((await loadTokenFiles(app, tenant, venue))?.files).toEqual([])
      // Hiding what is hidden changes nothing.
      expect(await setTableHidden(app, tenant, one.id, true)).toMatchObject({ retired: null })
      const shown = ok(await setTableHidden(app, tenant, one.id, false))
      expect(shown).toMatchObject({ retired: null, table: { hidden: false, token } })
      expect((await loadTokenFiles(app, tenant, venue))?.files.map((f) => f.token)).toEqual([token])
    })

    it('moves a table within and between areas, and reorders areas', async () => {
      const { venue } = await freshVenue([
        place('1', '1', 'A', { salonId: '1', salonWeight: 1 }),
        place('2', '2', 'A', { salonId: '1', salonWeight: 1 }),
        place('3', '3', 'A', { salonId: '1', salonWeight: 1 }),
        place('4', '4', 'B', { salonId: '2', salonWeight: 2 }),
      ])
      const [a, b] = await areasOf(venue)
      if (!a || !b) throw new Error('two areas expected')
      const three = await byNum(venue, '3')
      const one = await byNum(venue, '1')
      // Table 3 first in A.
      ok(await moveTable(app, tenant, { tableId: three.id, areaId: a.id, after: null }))
      expect((await tablesOf(venue)).map((t) => t.number)).toEqual(['3', '1', '2', '4'])
      // Table 1 into B, after 4.
      const four = await byNum(venue, '4')
      ok(await moveTable(app, tenant, { tableId: one.id, areaId: b.id, after: four.id }))
      expect((await tablesOf(venue)).map((t) => [t.number, t.areaId === b.id])).toEqual([
        ['3', false],
        ['2', false],
        ['4', true],
        ['1', true],
      ])
      // After a table that is not in the area, or into an area of another venue: refused.
      expect(
        await moveTable(app, tenant, { tableId: one.id, areaId: a.id, after: four.id }),
      ).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      const { venue: other } = await freshVenue([place('1', '1', 'X')])
      const [x] = await areasOf(other)
      expect(
        await moveTable(app, tenant, { tableId: one.id, areaId: x?.id ?? '', after: null }),
      ).toMatchObject({
        ok: false,
        error: 'unknown_area',
      })
      // Area B first.
      ok(await moveArea(app, tenant, b.id, null))
      expect((await areasOf(venue)).map((area) => area.name)).toEqual(['B', 'A'])
      ok(await moveArea(app, tenant, b.id, a.id))
      expect((await areasOf(venue)).map((area) => area.name)).toEqual(['A', 'B'])
      expect(await moveArea(app, tenant, b.id, x?.id ?? '')).toMatchObject({
        ok: false,
        error: 'unknown_area',
      })
    })

    it('hiding an area names the codes of its tables for removal and keeps them', async () => {
      const { venue } = await freshVenue([place('1', '1', 'A'), place('2', '2', 'A')])
      ok(await issueAllTableTokens(app, tenant, venue))
      const tokens = (await tablesOf(venue)).map((t) => t.token as string).sort()
      const [a] = await areasOf(venue)
      if (!a) throw new Error('no area')
      expect(ok(await setAreaHidden(app, tenant, a.id, true)).retired).toEqual(tokens)
      expect((await loadTokenFiles(app, tenant, venue))?.files).toEqual([])
      expect((await tablesOf(venue)).map((t) => t.token as string).sort()).toEqual(tokens)
      expect(ok(await setAreaHidden(app, tenant, a.id, false)).retired).toEqual([])
      expect((await loadTokenFiles(app, tenant, venue))?.files).toHaveLength(2)
      expect(await renameArea(app, tenant, a.id, ' ')).toMatchObject({
        ok: false,
        error: 'invalid_input',
      })
    })
  })

  describe('issueAllTableTokens', () => {
    it('codes the shown tables that have none (a missing one too), none for hidden ones, and leaves existing codes', async () => {
      const { venue, bid: venueBid } = await freshVenue([
        place('9401', '1'),
        place('9402', '2'),
        place('9403', null),
        place('9404', '4'),
      ])
      const two = await byNum(venue, '2')
      const existing = ok(await issueTableToken(app, tenant, two.id))

      // Table 4 goes missing (a complete pull that does not list it): its table stays.
      await pull(venueBid, [place('9401', '1'), place('9402', '2'), place('9403', null)])

      const result = await issueAllTableTokens(app, tenant, venue)
      expect(result).toMatchObject({ ok: true, venueId: venue, issued: 2, skippedNoLabel: 0 })
      const tables = await tablesOf(venue)
      expect(tables.find((table) => table.number === '1')?.token).toMatch(TOKEN)
      expect(tables.find((table) => table.number === '2')?.token).toBe(existing.table.token)
      expect(tables.find((table) => table.number === '4')?.token).toMatch(TOKEN)
      expect(tables.find((table) => table.number === '—')).toMatchObject({
        hidden: true,
        token: null,
      })

      // Nothing left to do: asking again changes nothing.
      expect(await issueAllTableTokens(app, tenant, venue)).toMatchObject({
        ok: true,
        issued: 0,
        skippedNoLabel: 0,
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
    it('lists the venue’s files: its slug, each shown code, the table’s name (ours, else the number) and the menu (none published here)', async () => {
      const { venue } = await freshVenue([
        place('9501', '7'),
        place('9502', '8'),
        place('9503', null),
      ])
      await issueAllTableTokens(app, tenant, venue)
      const eight = await byNum(venue, '8')
      await setTableName(app, tenant, eight.id, 'VIP 3')

      const files = await loadTokenFiles(app, tenant, venue)
      expect(files?.venueSlug).toMatch(/^tables-venue-\d+-[0-9a-f]{8}$/)
      // And the venue's public code, which the token files carry to find the venue by (D68).
      expect(files?.venuePublicId).toMatch(/^[a-z0-9]{12}$/)
      expect(files?.files.map((file) => file.tableLabel).sort()).toEqual(['7', 'VIP 3'])
      const seven = await byNum(venue, '7')
      expect(files?.files.find((file) => file.token === seven.token)).toEqual({
        token: seven.token,
        tableLabel: '7',
        menuId: null,
      })
      expect(await loadTokenFiles(app, otherTenant, venue)).toBeNull()
      expect(await loadTokenFiles(app, tenant, 'vn_nope')).toBeNull()
    })
  })

  describe('a table the till deletes', () => {
    it('keeps its code while it is only missing, loses it when deleted, and the token comes back to be removed', async () => {
      const { venue, bid: venueBid } = await freshVenue([place('9601', '1'), place('9602', '2')])
      await issueAllTableTokens(app, tenant, venue)
      const two = await byNum(venue, '2')
      const token = two.token as string

      // Not listed in a complete pull: missing; its sticker still works.
      const gone = await pull(venueBid, [place('9601', '1')])
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

      // Still absent after the grace period: deleted, and the table is archived without its code.
      const late = await pull(venueBid, [place('9601', '1')], new Date(Date.now() + 8 * DAY))
      expect(late).toMatchObject({ deleted: 1, retiredTokens: [token] })
      const rows = await withTenant(app, tenant, (tx) =>
        tx.select().from(venueTables).where(eq(venueTables.id, two.id)),
      )
      expect(rows[0]).toMatchObject({ qrToken: null })
      expect(rows[0]?.archivedAt).toBeInstanceOf(Date)
      expect((await tablesOf(venue)).map((table) => table.number)).toEqual(['1'])
      expect((await loadTokenFiles(app, tenant, venue))?.files).toHaveLength(1)
      expect(await issueTableToken(app, tenant, two.id)).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })

      // Listed again: the table comes back, without a code.
      await pull(venueBid, [place('9601', '1'), place('9602', '2')], new Date(Date.now() + 9 * DAY))
      expect(await byNum(venue, '2')).toMatchObject({ id: two.id, token: null })
    })
  })

  describe('a venue without a till: the owner’s own areas and tables', () => {
    it('creates, renumbers, names and deletes areas and tables; codes are retired with them', async () => {
      const venue = (
        await provisionVenue(app, tenant, { name: 'By hand', slug: testSlug('by-hand') })
      ).id
      const garden = ok(await createArea(app, tenant, venue, '  Garden  '))
      expect(garden.area).toMatchObject({ name: 'Garden', fromTill: false, hidden: false })
      const patio = ok(await createArea(app, tenant, venue, 'Patio'))
      expect((await areasOf(venue)).map((area) => area.name)).toEqual(['Garden', 'Patio'])

      const one = ok(
        await createTable(app, tenant, { areaId: garden.area.id, name: null, number: '1' }),
      )
      const bar = ok(
        await createTable(app, tenant, { areaId: garden.area.id, name: 'Bar', number: null }),
      )
      expect(one.table).toMatchObject({ number: '1', name: null, hidden: false, token: null })
      expect(bar.table).toMatchObject({ number: null, name: 'Bar' })
      expect((await tablesOf(venue)).map((t) => t.id)).toEqual([one.table.id, bar.table.id])
      expect(
        await createTable(app, tenant, { areaId: garden.area.id, name: ' ', number: null }),
      ).toMatchObject({
        ok: false,
        error: 'no_label',
      })
      // A table with no number cannot lose its name; given a number it can.
      expect(await setTableName(app, tenant, bar.table.id, null)).toMatchObject({
        ok: false,
        error: 'no_label',
      })
      ok(await setTableNumber(app, tenant, bar.table.id, '7'))
      expect(ok(await setTableName(app, tenant, bar.table.id, null)).table).toMatchObject({
        name: null,
        number: '7',
      })
      expect(await setTableNumber(app, tenant, bar.table.id, null)).toMatchObject({
        ok: false,
        error: 'no_label',
      })

      ok(await issueAllTableTokens(app, tenant, venue))
      const oneToken = (await byNum(venue, '1')).token as string
      const sevenToken = (await byNum(venue, '7')).token as string
      const deleted = ok(await deleteTable(app, tenant, one.table.id))
      expect(deleted.retired).toBe(oneToken)
      expect((await tablesOf(venue)).map((t) => t.number)).toEqual(['7'])
      const gone = ok(await deleteArea(app, tenant, garden.area.id))
      expect(gone.retired).toEqual([sevenToken])
      expect((await areasOf(venue)).map((area) => area.id)).toEqual([patio.area.id])
      expect(await tablesOf(venue)).toEqual([])
      expect(await deleteTable(app, tenant, bar.table.id)).toMatchObject({
        ok: false,
        error: 'unknown_table',
      })
      expect(
        await createTable(app, tenant, { areaId: garden.area.id, name: null, number: '2' }),
      ).toMatchObject({
        ok: false,
        error: 'unknown_area',
      })
    })

    it('a venue that serves a till gets none of that: its areas and tables are the till’s', async () => {
      const { venue } = await freshVenue([place('9801', '1')])
      const [hall] = await areasOf(venue)
      const one = await byNum(venue, '1')
      const refused = { ok: false, error: 'from_till' }
      expect(await createArea(app, tenant, venue, 'Mine')).toMatchObject(refused)
      expect(
        await createTable(app, tenant, { areaId: hall?.id ?? '', name: null, number: '2' }),
      ).toMatchObject(refused)
      expect(await deleteTable(app, tenant, one.id)).toMatchObject(refused)
      expect(await deleteArea(app, tenant, hall?.id ?? '')).toMatchObject(refused)
      expect(await setTableNumber(app, tenant, one.id, '2')).toMatchObject(refused)
      expect(await tablesOf(venue)).toHaveLength(1)
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

  it('has its areas and tables only in its own tenant (row-level security)', async () => {
    const { venue } = await freshVenue([place('9701', '1')])
    expect(await tablesOf(venue)).toHaveLength(1)
    const other = await withTenant(app, otherTenant, (tx) =>
      tx.select().from(venueTables).where(eq(venueTables.venueId, venue)),
    )
    expect(other).toEqual([])
    expect(await listVenueAreas(app, otherTenant, venue)).toEqual([])
  })
})
