// Integration tests of the floor reading's writer (#71) as the restro_app role on a real Postgres:
// a complete reading becomes the venue's bars and tables, an incomplete one writes nothing (rule 6,
// by property), a vanished table is marked and never deleted, a listed-again one comes back, an
// empty floor is held, the payment tables follow the POS's mark or the venue's source once, and
// two venues share one instance by picking different halls or bars. Skipped without a database.
import { areas, bars, createPool, type DbPool, places, venueTables, withTenant } from '@restro/db'
import fc from 'fast-check'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Floor, NO_SERVICE_CAPABILITIES, posRef, type Reading } from '../connectors/service'
import { newId } from '../ids'
import { readServiceCapabilities } from '../service-capabilities-config'
import { mapBarsyVenue, upsertBarsyVenues } from './barsy-venues'
import { applyFloor, setFloorSource } from './floor'
import { provisionTenant, provisionVenue } from './provision'
import { createIntegration } from './sources'
import { readSyncState, updateSyncState } from './sync-config'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

interface T {
  readonly pos: string
  readonly name: string
  readonly area: string | null
  readonly bar: string | null
  readonly payment?: boolean | null
}

function floorOf(tables: readonly T[], barList: readonly (readonly [string, string])[]): Floor {
  return {
    tables: tables.map((table) => ({
      ref: posRef(table.pos),
      name: table.name,
      area: table.area,
      bar: table.bar === null ? null : posRef(table.bar),
      paymentTable: table.payment ?? null,
    })),
    bars: barList.map(([key, name]) => ({ ref: posRef(key), name })),
  }
}

const complete = (value: Floor): Reading<Floor> => ({ complete: true, value })

const BARS = [
  ['b-main', 'Main bar'],
  ['b-up', 'Upstairs'],
] as const

const FLOOR = floorOf(
  [
    { pos: 't1', name: '1', area: 'Main hall', bar: 'b-main' },
    { pos: 't2', name: '2', area: 'Main hall', bar: 'b-main' },
    { pos: 't3', name: '3', area: 'Upstairs', bar: 'b-up' },
    { pos: 't4', name: '4', area: 'Upstairs', bar: 'b-up' },
    { pos: 'p1', name: 'PM1', area: 'Main hall', bar: 'b-main' },
    { pos: 'p2', name: 'PU1', area: 'Upstairs', bar: 'b-up' },
  ],
  BARS,
)

describe.skipIf(!hasDatabase)('the floor reading (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let nextBid = 1

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-floor-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Floor club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  /** A POS instance of its own, so one test's tables are never another's. */
  let nextHost = 1
  const instance = async () =>
    (await createIntegration(app, tenant, { kind: 'sim', host: `floor-${nextHost++}.test` })).id

  /** A venue served by a fresh till venue of an instance (a new one unless given). */
  async function venue(name: string, integrationId?: string) {
    const instanceId = integrationId ?? (await instance())
    const created = await provisionVenue(app, tenant, { name, slug: testSlug('floor') })
    const bid = nextBid++
    await upsertBarsyVenues(app, tenant, instanceId, [{ bid, name }])
    const mapped = await mapBarsyVenue(app, tenant, instanceId, bid, created.id)
    expect(mapped.ok).toBe(true)
    return { venueId: created.id, bid, integrationId: instanceId }
  }

  const read = (at: { bid: number; integrationId: string }, reading: Reading<Floor>, now?: Date) =>
    applyFloor(app, tenant, {
      integrationId: at.integrationId,
      bid: at.bid,
      jobId: newId('jb'),
      reading,
      ...(now === undefined ? {} : { now }),
    })

  const tablesOf = (venueId: string) =>
    withTenant(app, tenant, (tx) =>
      tx.select().from(venueTables).where(eqVenue(venueTables.venueId, venueId)),
    )
  const barsOf = (venueId: string) =>
    withTenant(app, tenant, (tx) => tx.select().from(bars).where(eqVenue(bars.venueId, venueId)))
  const placesOf = (bid: number) =>
    withTenant(app, tenant, (tx) => tx.select().from(places).where(eqVenue(places.bid, bid)))

  it('writes the bars and tables of a complete reading, each table with its bar', async () => {
    const at = await venue('Demo Bar')
    const { venueId, bid } = at
    const result = await read(at, complete(FLOOR))
    if (result.kind !== 'applied') throw new Error(`not applied: ${JSON.stringify(result)}`)
    expect(result).toMatchObject({ listed: 6, tablesCreated: 6, barsCreated: 2, held: null })
    const tables = await tablesOf(venueId)
    const stored = await barsOf(venueId)
    expect(tables).toHaveLength(6)
    expect(stored.map((bar) => bar.name).sort()).toEqual(['Main bar', 'Upstairs'])
    const byNumber = new Map(tables.map((table) => [table.number, table]))
    const barName = (tableNumber: string) =>
      stored.find((bar) => bar.id === byNumber.get(tableNumber)?.barId)?.name
    expect(barName('1')).toBe('Main bar')
    expect(barName('4')).toBe('Upstairs')
    // The halls became areas, keyed by their name.
    const rows = await withTenant(app, tenant, (tx) =>
      tx.select().from(areas).where(eqVenue(areas.venueId, venueId)),
    )
    expect(rows.map((area) => area.name).sort()).toEqual(['Main hall', 'Upstairs'])
    // The POS's own ids stay in `places` (rule 3), never in the platform's rows.
    expect(JSON.stringify(tables)).not.toContain('"t1"')
    expect((await placesOf(bid)).map((place) => place.placeId).sort()).toContain('t1')
  })

  it('changes nothing when the same reading comes again', async () => {
    const at = await venue('Repeat Bar')
    const { venueId } = at
    await read(at, complete(FLOOR))
    const before = JSON.stringify([await tablesOf(venueId), await barsOf(venueId)])
    const again = await read(at, complete(FLOOR))
    expect(again).toMatchObject({
      kind: 'applied',
      tablesCreated: 0,
      tablesUpdated: 0,
      barsCreated: 0,
    })
    expect(JSON.stringify([await tablesOf(venueId), await barsOf(venueId)])).toBe(before)
  })

  it('writes nothing for a reading that is not complete (rule 6), whatever it lists', async () => {
    const at = await venue('Partial Bar')
    const { venueId, bid } = at
    await read(at, complete(FLOOR))
    const before = JSON.stringify([
      await tablesOf(venueId),
      await barsOf(venueId),
      await placesOf(bid),
    ])
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (reason) => {
        const result = await read(at, { complete: false, reason })
        expect(result).toEqual({ kind: 'incomplete', reason })
        expect(
          JSON.stringify([await tablesOf(venueId), await barsOf(venueId), await placesOf(bid)]),
        ).toBe(before)
      }),
      { numRuns: 15 },
    )
  })

  it('marks a table that vanished missing, never deletes it, and brings it back when listed again', async () => {
    const at = await venue('Vanish Bar')
    const { venueId, bid } = at
    await read(at, complete(FLOOR))
    const before = await tablesOf(venueId)
    const t3 = (await placesOf(bid)).find((place) => place.placeId === 't3')
    const shrunk = floorOf(
      [
        { pos: 't1', name: '1', area: 'Main hall', bar: 'b-main' },
        { pos: 't2', name: '2', area: 'Main hall', bar: 'b-main' },
        { pos: 't3', name: '3', area: 'Upstairs', bar: 'b-up' },
        { pos: 'p1', name: 'PM1', area: 'Main hall', bar: 'b-main' },
        { pos: 'p2', name: 'PU1', area: 'Upstairs', bar: 'b-up' },
      ],
      BARS,
    )
    const gone = await read(at, complete(shrunk))
    expect(gone).toMatchObject({ kind: 'applied', held: null })
    const t4Table = (await placesOf(bid)).find((place) => place.placeId === 't4')
    if (gone.kind !== 'applied') throw new Error('not applied')
    expect(gone.vanished).toEqual([t4Table?.tableId])
    expect((await placesOf(bid)).find((place) => place.placeId === 't4')?.state).toBe('missing')
    // The table is still there, not archived, and its code is untouched.
    const after = await tablesOf(venueId)
    expect(after).toHaveLength(before.length)
    expect(after.find((table) => table.id === t4Table?.tableId)?.archivedAt).toBeNull()
    expect(t3?.state).toBe('active')

    const back = await read(at, complete(FLOOR))
    if (back.kind !== 'applied') throw new Error('not applied')
    expect(back.returned).toEqual([t4Table?.tableId])
    expect((await placesOf(bid)).find((place) => place.placeId === 't4')?.state).toBe('active')
  })

  it('holds an empty floor: nothing goes missing', async () => {
    const at = await venue('Empty Bar')
    const { bid } = at
    await read(at, complete(FLOOR))
    const empty = await read(at, complete(floorOf([], [])))
    expect(empty).toMatchObject({ kind: 'applied', vanished: [], held: { reason: 'empty_read' } })
    expect((await placesOf(bid)).every((place) => place.state === 'active')).toBe(true)
  })

  it('writes only bars the POS reports: none made up, a table with no bar has none (D124 §1)', async () => {
    const at = await venue('No Bars Bar')
    const { venueId } = at
    const result = await read(
      at,
      complete(floorOf([{ pos: 'n1', name: '1', area: 'Hall', bar: null }], [])),
    )
    expect(result).toMatchObject({ kind: 'applied', barsCreated: 0 })
    expect(await barsOf(venueId)).toHaveLength(0)
    expect((await tablesOf(venueId))[0]?.barId).toBeNull()
  })

  it("follows a bar's name from the POS and archives a bar the POS no longer lists (never deletes)", async () => {
    const at = await venue('Bars Bar')
    const { venueId } = at
    await read(at, complete(FLOOR))
    const renamed = floorOf(
      [
        { pos: 't1', name: '1', area: 'Main hall', bar: 'b-main' },
        { pos: 't2', name: '2', area: 'Main hall', bar: 'b-main' },
        { pos: 't3', name: '3', area: 'Upstairs', bar: 'b-main' },
        { pos: 't4', name: '4', area: 'Upstairs', bar: 'b-main' },
        { pos: 'p1', name: 'PM1', area: 'Main hall', bar: 'b-main' },
        { pos: 'p2', name: 'PU1', area: 'Upstairs', bar: 'b-main' },
      ],
      [['b-main', 'Front bar']],
    )
    const result = await read(at, complete(renamed))
    expect(result).toMatchObject({ kind: 'applied', barsArchived: 1 })
    const stored = await barsOf(venueId)
    expect(stored).toHaveLength(2)
    expect(stored.find((bar) => bar.sourceKey === 'b-main')?.name).toBe('Front bar')
    expect(stored.find((bar) => bar.sourceKey === 'b-up')?.archivedAt).not.toBeNull()
    expect(
      (await tablesOf(venueId)).every(
        (table) => table.barId === stored.find((b) => b.sourceKey === 'b-main')?.id,
      ),
    ).toBe(true)
  })

  it("marks payment tables from the venue's source when they first appear, hidden, and follows the POS's own mark", async () => {
    const at = await venue('Payment Bar')
    const { venueId } = at
    await setFloorSource(app, tenant, {
      venueId,
      source: { halls: null, bars: null, paymentTables: ['PM1', 'PU1'] },
    })
    await read(at, complete(FLOOR))
    const tables = await tablesOf(venueId)
    const marked = tables.filter((table) => table.isPaymentTable)
    expect(marked.map((table) => table.number).sort()).toEqual(['PM1', 'PU1'])
    expect(marked.every((table) => table.hidden)).toBe(true)
    // A manager's later change stays: the source names tables only for the first time.
    await withTenant(app, tenant, async () => undefined)
    await owner.query('update restro.tables set is_payment_table = false where id = $1', [
      marked[0]?.id,
    ])
    await read(at, complete(FLOOR))
    expect((await tablesOf(venueId)).filter((table) => table.isPaymentTable)).toHaveLength(1)
    // A POS that marks its own is followed.
    const marking = floorOf(
      FLOOR.tables.map((table) => ({
        pos: table.ref.pos,
        name: table.name,
        area: table.area,
        bar: table.bar?.pos ?? null,
        payment: table.name === 'PM1',
      })),
      BARS,
    )
    await read(at, complete(marking))
    const after = await tablesOf(venueId)
    expect(after.filter((table) => table.isPaymentTable).map((table) => table.number)).toEqual([
      'PM1',
    ])
  })

  it('lets two venues share one instance, each picking its halls or its bars', async () => {
    const first = await venue('Club')
    const second = await venue('Restaurant', first.integrationId)
    await setFloorSource(app, tenant, {
      venueId: first.venueId,
      source: { halls: ['Main hall'], bars: null, paymentTables: [] },
    })
    await setFloorSource(app, tenant, {
      venueId: second.venueId,
      source: { halls: null, bars: ['b-up'], paymentTables: [] },
    })
    const a = await read(first, complete(FLOOR))
    const b = await read(second, complete(FLOOR))
    expect(a).toMatchObject({ kind: 'applied', listed: 3 })
    expect(b).toMatchObject({ kind: 'applied', listed: 3, skippedClaimed: 0 })
    expect((await tablesOf(first.venueId)).map((table) => table.number).sort()).toEqual([
      '1',
      '2',
      'PM1',
    ])
    expect((await tablesOf(second.venueId)).map((table) => table.number).sort()).toEqual([
      '3',
      '4',
      'PU1',
    ])
    // Each venue has only the bar it serves.
    expect((await barsOf(first.venueId)).map((bar) => bar.name)).toEqual(['Main bar'])
    expect((await barsOf(second.venueId)).map((bar) => bar.name)).toEqual(['Upstairs'])
  })

  it('serves a table to one venue only: the second venue skips what the first has', async () => {
    const first = await venue('First')
    const second = await venue('Second', first.integrationId)
    await read(first, complete(FLOOR))
    const overlapping = await read(second, complete(FLOOR))
    expect(overlapping).toMatchObject({ kind: 'applied', listed: 0, skippedClaimed: 6 })
    expect(await tablesOf(second.venueId)).toHaveLength(0)
  })

  it("records the connector's declaration with a complete reading, once, leaving config.sync alone (#78)", async () => {
    const at = await venue('Capabilities Bar')
    const cursor = '2026-10-26T20:00:00.000+00:00'
    expect(await updateSyncState(app, tenant, at.integrationId, at.bid, { cursor })).toBe(true)
    const configOf = async () =>
      (
        await owner.query('select config from restro.integrations where id = $1', [
          at.integrationId,
        ])
      ).rows[0]?.config
    const declared = { ...NO_SERVICE_CAPABILITIES, notesReachTicket: true }
    const tick = (capabilities: typeof declared, reading: Reading<Floor> = complete(FLOOR)) =>
      applyFloor(app, tenant, {
        integrationId: at.integrationId,
        bid: at.bid,
        jobId: newId('jb'),
        reading,
        capabilities,
      })

    // Rule 6: an incomplete reading records nothing either.
    expect(await tick(declared, { complete: false, reason: 'page 2 failed' })).toMatchObject({
      kind: 'incomplete',
    })
    expect(readServiceCapabilities(await configOf())).toEqual({
      notesReachTicket: false,
      firstItemsOpenBill: false,
      recordTipOnClose: false,
    })

    expect(await tick(declared)).toMatchObject({ kind: 'applied', capabilitiesRecorded: true })
    const config = await configOf()
    expect(readServiceCapabilities(config)).toEqual({
      notesReachTicket: true,
      firstItemsOpenBill: false,
      recordTipOnClose: false,
    })
    expect(config.service_capabilities).toMatchObject({ notes_reach_ticket: true })
    expect(readSyncState(config, at.bid)).toEqual({ cursor })

    // The same declaration writes nothing again; a changed one is recorded.
    expect(await tick(declared)).toMatchObject({ capabilitiesRecorded: false })
    expect(
      await tick({ ...declared, notesReachTicket: false, firstItemsOpenBill: true }),
    ).toMatchObject({ capabilitiesRecorded: true })
    expect(readServiceCapabilities(await configOf())).toEqual({
      notesReachTicket: false,
      firstItemsOpenBill: true,
      recordTipOnClose: false,
    })
    expect(readSyncState(await configOf(), at.bid)).toEqual({ cursor })
  })

  it('answers not_linked for a till venue that serves no venue', async () => {
    const integrationId = await instance()
    const bid = nextBid++
    await upsertBarsyVenues(app, tenant, integrationId, [{ bid, name: 'Unmapped' }])
    expect(await read({ bid, integrationId }, complete(FLOOR))).toMatchObject({
      kind: 'not_linked',
    })
  })

  it('refuses a bad id before touching the database', async () => {
    const integrationId = await instance()
    await expect(
      applyFloor(app, tenant, {
        integrationId: 'nope',
        bid: 1,
        jobId: newId('jb'),
        reading: complete(FLOOR),
      }),
    ).rejects.toThrow(TypeError)
    await expect(
      applyFloor(app, tenant, { integrationId, bid: 1, jobId: 'job', reading: complete(FLOOR) }),
    ).rejects.toThrow(TypeError)
  })
})

import type { AnyColumn } from 'drizzle-orm'
import { eq as drizzleEq } from 'drizzle-orm'

function eqVenue(column: AnyColumn, value: string | number) {
  return drizzleEq(column, value)
}
