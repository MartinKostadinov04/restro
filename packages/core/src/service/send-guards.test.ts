// Send's guards (#78; D117, D118, D122 §4). `roundKey` alone, then on a real Postgres as the
// restro_app role: the duplicate check asks first and a new action naming the sent order sends it
// again; a Not sent order or another sitting is no duplicate; a round over the cap or past the pace
// refuses, pauses the table for "ask your waiter" and writes one Log entry per table, guard and
// minute; a pace trip raises one alert to Restro's admin team; a sold-out line stays on the order
// while the others go; where the POS takes no notes or options, a line with them or an item that
// must have options is ordered from the waiter; where first items don't open a bill, a table a
// fresh reading shows with no bill asks the waiter for the first item. Database parts skipped
// without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'
import { guestResult } from './guest'
import { refused } from './results'
import { GUARD_TRIPPED_CAUSE, ORDER_PACE_ALERT, roundKey } from './send-guards'
import type { SendMenu } from './send-menu'

describe('roundKey', () => {
  const gin = newId('nd')
  const lime = newId('nd')
  const ice = newId('nd')

  it('compares items and quantities, merging identical lines and ignoring order', () => {
    expect(
      roundKey([
        { itemId: gin, optionIds: [lime, ice], qty: 1 },
        { itemId: gin, optionIds: [], qty: 2 },
        { itemId: gin, optionIds: [ice, lime], qty: 1 },
      ]),
    ).toBe(
      roundKey([
        { itemId: gin, optionIds: [], qty: 2 },
        { itemId: gin, optionIds: [lime, ice], qty: 2 },
      ]),
    )
    expect(roundKey([{ itemId: gin, optionIds: [], qty: 2 }])).not.toBe(
      roundKey([{ itemId: gin, optionIds: [], qty: 3 }]),
    )
    expect(roundKey([{ itemId: gin, optionIds: [lime], qty: 1 }])).not.toBe(
      roundKey([{ itemId: gin, optionIds: [], qty: 1 }]),
    )
  })
})

describe("a duplicate Send's answer to the phone", () => {
  it('names the sent order it repeats, so the phone can ask "Same as 4 minutes ago"', () => {
    const duplicateOf = newId('so')
    expect(
      guestResult(refused('a1', 'duplicate_order', { duplicateOf, minutesAgo: 4 })),
    ).toMatchObject({ status: 'rejected', code: 'duplicate_order', subjectId: duplicateOf })
  })
})

describe.skipIf(!hasDatabase)("Send's guards (as the restro_app role)", () => {
  let world: ServiceWorld
  let tableId: string
  let sittingId: string
  let codeHash: string
  const beer = newId('nd')
  const cola = newId('nd')
  const shot = newId('nd')
  const lime = newId('nd')

  const menu: SendMenu = {
    currency: 'EUR',
    items: new Map([
      [
        beer,
        { priceMinor: 450, orderable: true, soldOut: false, name: 'Beer', options: new Map() },
      ],
      [cola, { priceMinor: 300, orderable: true, soldOut: true, name: 'Cola', options: new Map() }],
      [
        shot,
        {
          priceMinor: 400,
          orderable: true,
          soldOut: false,
          name: 'Shot',
          options: new Map([[lime, { deltaMinor: 0, name: 'Lime' }]]),
          requiredOptions: true,
        },
      ],
    ]),
  }

  const guest = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codeHash,
    sittingId,
    consentVersion: 'v1',
  })

  async function settings(change: Partial<OrderingSettings>) {
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      [
        world.venueId,
        JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false, ...change }),
      ],
    )
  }

  async function add(itemId: string, qty: number, note = '', optionIds: string[] = []) {
    const { result } = await applyService(
      world.app,
      {
        type: 'order.add',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        itemId,
        optionIds,
        qty,
        note,
      },
      guest(),
    )
    expect(result.status).toBe('accepted')
  }

  /** The order's live lines, as a guest would name them. */
  async function orderLines() {
    const { rows } = await world.owner.query(
      'select lines from restro.table_orders where table_id = $1 and sitting_id = $2',
      [tableId, sittingId],
    )
    const lines = (rows[0]?.lines ?? []) as {
      itemId: string
      optionIds: string[]
      qty: number
      note: string
      removedAt: number | null
    }[]
    return lines
      .filter((line) => line.removedAt === null)
      .map(({ itemId, optionIds, qty, note }) => ({ itemId, optionIds, qty, note }))
  }

  async function send(
    options: {
      readonly confirmDuplicateOf?: string
      readonly only?: (itemId: string) => boolean
    } = {},
  ) {
    const lines = (await orderLines()).filter((line) => options.only?.(line.itemId) ?? true)
    const { result } = await applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        lines,
        ...(options.confirmDuplicateOf === undefined
          ? {}
          : { confirmDuplicateOf: options.confirmDuplicateOf }),
      },
      guest(),
      { sendMenu: menu },
    )
    return result
  }

  async function sentOrdersOfTable(): Promise<number> {
    const { rows } = await world.owner.query(
      `select count(*)::int as n from restro.sent_orders where table_id = $1 and state <> 'not_sent'`,
      [tableId],
    )
    return rows[0]?.n as number
  }

  async function activePauses() {
    const { rows } = await world.owner.query(
      `select cause, restro_started, details from restro.pauses
        where target_id = $1 and lifted_at is null`,
      [tableId],
    )
    return rows
  }

  async function trips(reason: string): Promise<number> {
    const { rows } = await world.owner.query(
      `select count(*)::int as n from restro.log_entries
        where table_id = $1 and kind = 'guard.tripped' and reason = $2`,
      [tableId, reason],
    )
    return rows[0]?.n as number
  }

  async function openPaceAlerts() {
    const { rows } = await world.owner.query(
      `select audience, details from restro.alerts
        where subject_id = $1 and kind = $2 and done_at is null`,
      [tableId, ORDER_PACE_ALERT],
    )
    return rows
  }

  beforeAll(async () => {
    world = await openServiceWorld('send-guards')
    const code = `code${randomUUID().replaceAll('-', '')}`
    codeHash = await hashTableCode(code)
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [world.tables[0], code, codeHash],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    // Each test starts with the cap and pace off, on a table of its own history: the pace counts
    // a table's sent orders over every sitting, so earlier tests' rounds are settled Not sent.
    tableId = world.tables[0] as string
    await settings({ capMinor: null, pacePer15Minutes: null })
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where table_id = $1 and state <> 'not_sent'`,
      [tableId],
    )
    await world.owner.query(
      'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
      [tableId],
    )
    await world.owner.query(
      `update restro.alerts set done_at = now() where subject_id = $1 and done_at is null`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
    await world.declareCapabilities({ notesReachTicket: false, firstItemsOpenBill: false })
    await world.owner.query('delete from restro.bill_readings where table_id = $1', [tableId])
  })

  /** Empties the order (what Remove on each line would do). */
  const clearOrder = () =>
    world.owner.query(
      `update restro.table_orders set lines = '[]'::jsonb where table_id = $1 and sitting_id = $2`,
      [tableId, sittingId],
    )

  /** A complete reading of the table, `age` old, with no open POS bill. */
  const readNoBill = (age: string) =>
    world.owner.query(
      `insert into restro.bill_readings
         (tenant_id, venue_id, table_id, read_at, complete, source, actor, job_id)
       values ($1, $2, $3, now() - $4::interval, true, 'worker', 'system', 'test-reading')`,
      [world.tenantId, world.venueId, tableId, age],
    )

  it('asks before sending the same round again, and sends it on a new action naming the first', async () => {
    await add(beer, 2)
    const first = await send()
    expect(first.status).toBe('accepted')
    const firstId = first.details.sentOrderId as string

    // The same items and quantities, even with a note, split over two lines.
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: false })
    await add(beer, 1, 'cold')
    await add(beer, 1)
    const asked = await send()
    expect(asked).toMatchObject({
      status: 'refused',
      code: 'duplicate_order',
      details: { duplicateOf: firstId, minutesAgo: 0 },
    })
    expect(await orderLines()).toHaveLength(2)

    // Naming another sent order confirms nothing.
    expect(await send({ confirmDuplicateOf: newId('so') })).toMatchObject({
      code: 'duplicate_order',
    })
    const again = await send({ confirmDuplicateOf: firstId })
    expect(again.status).toBe('accepted')
    expect(await orderLines()).toEqual([])
    expect(await sentOrdersOfTable()).toBe(2)

    // A different round goes at once.
    await add(beer, 1)
    expect((await send()).status).toBe('accepted')
  })

  it('counts neither a Not sent order nor another sitting as a duplicate', async () => {
    await add(beer, 1)
    const first = await send()
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'pos_unreachable', settled_at = now()
        where id = $1`,
      [first.details.sentOrderId],
    )
    await add(beer, 1)
    const second = await send()
    expect(second.status).toBe('accepted')

    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where id = $1',
      [sittingId, 'new_guests'],
    )
    sittingId = await world.openSitting(tableId)
    await add(beer, 1)
    expect((await send()).status).toBe('accepted')
  })

  it('lets a round exactly at the cap through', async () => {
    await settings({ capMinor: 1350 })
    await add(beer, 3)
    expect((await send()).status).toBe('accepted')
  })

  it('refuses a round over the cap, pausing the table for "ask your waiter" with one Log entry', async () => {
    await settings({ capMinor: 1000 })
    await add(beer, 3)
    const tripped = await send()
    expect(tripped).toMatchObject({
      status: 'refused',
      code: 'guard_tripped',
      details: { guard: 'cap', capMinor: 1000, totalMinor: 1350 },
    })
    expect(await sentOrdersOfTable()).toBe(0)
    expect(await orderLines()).toEqual([{ itemId: beer, optionIds: [], qty: 3, note: '' }])
    expect(await activePauses()).toMatchObject([
      { cause: GUARD_TRIPPED_CAUSE, details: { guard: 'cap', sittingId } },
    ])
    expect(await trips('order_cap')).toBe(1)
    expect(await openPaceAlerts()).toEqual([])

    // The table stays paused: the next Send is refused before any guard.
    expect(await send()).toMatchObject({ code: 'ordering_paused' })
  })

  it('refuses past the pace, pauses the table and alerts the Restro team once', async () => {
    await settings({ pacePer15Minutes: 3 })
    for (let round = 1; round <= 3; round++) {
      await add(beer, round)
      expect((await send()).status).toBe('accepted')
    }
    await add(beer, 4)
    expect(await send()).toMatchObject({
      status: 'refused',
      code: 'guard_tripped',
      details: { guard: 'pace', pacePer15Minutes: 3 },
    })
    expect(await activePauses()).toMatchObject([{ cause: GUARD_TRIPPED_CAUSE }])
    expect(await openPaceAlerts()).toMatchObject([{ audience: 'restro' }])
    expect(await trips('order_pace')).toBe(1)

    // Staff resume; the next trip in the same minute writes no second entry and no second alert.
    await world.owner.query(
      'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
      [tableId],
    )
    expect(await send()).toMatchObject({ code: 'guard_tripped' })
    expect(await trips('order_pace')).toBe(1)
    expect(await openPaceAlerts()).toHaveLength(1)
    expect(await activePauses()).toHaveLength(1)
  })

  it('orders from the waiter what the POS takes no note or option of, until it declares it does', async () => {
    await add(beer, 1, 'no ice')
    expect(await send()).toMatchObject({
      status: 'refused',
      code: 'order_from_waiter',
      details: { itemId: beer },
    })
    // An item that must have options can't go without them either.
    await clearOrder()
    await add(shot, 1)
    expect(await send()).toMatchObject({ code: 'order_from_waiter', details: { itemId: shot } })
    expect(await sentOrdersOfTable()).toBe(0)

    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: false })
    await clearOrder()
    await add(shot, 1, 'salt', [lime])
    expect((await send()).status).toBe('accepted')
  })

  describe('a reading of the table (repair-review)', () => {
    const BILL_IDS = 'send-guards-test-key-'.padEnd(48, 'x')
    const record = async (reading: unknown) =>
      (
        await applyService(
          world.app,
          { type: 'reading.record', tableId, reading } as never,
          {
            tenantId: world.tenantId,
            venueId: world.venueId,
            origin: 'worker',
            actor: { kind: 'system' },
            jobId: `jb-${randomUUID()}`,
          },
          { billIdKey: BILL_IDS },
        )
      ).result
    const withBill = {
      complete: true,
      currency: 'EUR',
      bills: [
        {
          pos: 'bill-1',
          totalMinor: 450,
          paidMinor: 0,
          openedAt: new Date().toISOString(),
          openedByRestro: false,
          paymentInFlight: false,
          lines: [
            {
              pos: 'row-1',
              itemPos: null,
              posName: 'Beer',
              quantity: '1',
              amountMinor: 450,
              enteredBy: 'staff',
              enteredAt: null,
              restroRef: null,
            },
          ],
        },
      ],
    }

    // RR-29, D120: "A single failed reading of one bill only pauses that table until its next good
    // reading (D111)."
    it('a failed reading pauses the table until its next good reading', async () => {
      await add(beer, 1)
      expect(await record(withBill)).toMatchObject({ status: 'accepted' })
      expect(
        await record({ complete: false, reason: 'the table could not be read' }),
      ).toMatchObject({ status: 'accepted', details: { complete: false } })
      expect(await send()).toMatchObject({ status: 'refused', code: 'ordering_paused' })
      expect(await record(withBill)).toMatchObject({ status: 'accepted' })
      expect((await send()).status).toBe('accepted')
    })

    // RR-27, D122 §2 ("ask your waiter to put your first item on" is for a table with no POS bill),
    // rule 6: the sitting's end empties the stored reading, which is no reading of the POS. A new
    // group at a table whose POS bill is still open is not told to ask for a first item.
    it('new guests on a table whose bill stays open are not asked for a first item', async () => {
      expect(await record(withBill)).toMatchObject({ status: 'accepted' })
      const managerId = await world.addUser('owner')
      const { result } = await applyService(world.app, { type: 'table.new_guests', tableId }, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: managerId, sessionId: `se-${randomUUID()}` },
        jobId: `jb-${randomUUID()}`,
        signedInAt: new Date(),
      } as never)
      expect(result).toMatchObject({ status: 'accepted' })
      const { rows } = await world.owner.query<{ id: string }>(
        'select id from restro.sittings where table_id = $1 and ended_at is null',
        [tableId],
      )
      sittingId = rows[0]?.id as string
      await add(beer, 1)
      expect(await send()).not.toMatchObject({ code: 'needs_first_item' })

      // A real reading of the POS still speaks: complete, empty and fresh, it asks for a first item.
      expect(await record({ complete: true, currency: 'EUR', bills: [] })).toMatchObject({
        status: 'accepted',
      })
      await add(beer, 1)
      expect(await send()).toMatchObject({ status: 'refused', code: 'needs_first_item' })
    })

    it("lifts only the failed reading's pause at a good reading, and starts one however many fail", async () => {
      const failed = { complete: false, reason: 'the table could not be read' }
      expect(await record(withBill)).toMatchObject({ status: 'accepted' })
      // The world is shared: only this test's pauses count.
      const since = (await world.owner.query<{ now: Date }>('select now() as now')).rows[0]?.now
      await record(failed)
      await record(failed)
      const pausesOf = async () =>
        (
          await world.owner.query<{ cause: string; lifted: boolean; reason: string | null }>(
            `select cause, lifted_at is not null as lifted, lift_reason as reason
               from restro.pauses
              where scope = 'table' and target_id = $1 and started_at >= $2
              order by started_at`,
            [tableId, since],
          )
        ).rows
      expect(await pausesOf()).toEqual([{ cause: 'pos_unreachable', lifted: false, reason: null }])
      await world.owner.query(
        `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause,
           restro_started, details, source, actor, job_id)
         values ($1, $2, $3, current_date, 'table', $4, 'order_unconfirmed', true, '{}'::jsonb,
           'worker', 'system', 'test-pause')`,
        [newId('pa'), world.tenantId, world.venueId, tableId],
      )
      expect(await record(withBill)).toMatchObject({ status: 'accepted' })
      expect(await pausesOf()).toEqual([
        { cause: 'pos_unreachable', lifted: true, reason: 'good_reading' },
        { cause: 'order_unconfirmed', lifted: false, reason: null },
      ])
    })
  })

  it('asks the waiter for the first item where a fresh reading shows no POS bill', async () => {
    await readNoBill('20 seconds')
    await add(beer, 1)
    expect(await send()).toMatchObject({ status: 'refused', code: 'needs_first_item' })
    expect(await orderLines()).toHaveLength(1)

    // An old reading concludes nothing: the Send goes and the POS answers.
    await world.owner.query(
      `update restro.bill_readings set read_at = now() - interval '5 minutes' where table_id = $1`,
      [tableId],
    )
    expect((await send()).status).toBe('accepted')

    // Where first items open a bill, a fresh empty reading is no reason to refuse.
    await world.owner.query('update restro.bill_readings set read_at = now() where table_id = $1', [
      tableId,
    ])
    await world.declareCapabilities({ notesReachTicket: false, firstItemsOpenBill: true })
    await add(beer, 2)
    expect((await send()).status).toBe('accepted')
  })

  it('sends the other lines and keeps a sold-out one on the order', async () => {
    await add(beer, 1)
    await add(cola, 1)
    expect(await send()).toMatchObject({
      status: 'refused',
      code: 'item_unavailable',
      details: { itemId: cola, others: 1 },
    })
    const sent = await send({ only: (itemId) => itemId !== cola })
    expect(sent.status).toBe('accepted')
    expect(await orderLines()).toEqual([{ itemId: cola, optionIds: [], qty: 1, note: '' }])
  })
})
