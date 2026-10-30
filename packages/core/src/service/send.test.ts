// Integration tests of Send and a sent order's way to the POS (#77, D115–D117, D120) on a real
// Postgres, as the restro_app role: a Send takes the order's lines into a `waiting` sent order with
// a reference, its notes kept apart and the pass's consent version recorded; a repeat gets the
// first answer; a pause, a missing menu, a sold-out item or a changed order refuses it and the
// lines stay. Then the worker's steps: the slot lease, Added, Not sent giving the lines back, a
// closed table, Unconfirmed pausing the table with one alert and settling the orders behind it,
// and the sweep's expiry. The menu is passed in (`sendMenu`), as the guest API reads it before the
// transaction. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { DEFAULT_ORDERING_SETTINGS } from '../ordering-settings'
import { hashTableCode } from '../qr'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { applyService } from './apply-service'
import type { ServiceContext } from './context'
import type { SendMenu } from './send-menu'
import { ORDER_UNCONFIRMED_ALERT, ORDER_UNCONFIRMED_CAUSE } from './sent-order'

describe.skipIf(!hasDatabase)('Send and the sent order (as the restro_app role)', () => {
  let world: ServiceWorld
  let tableId: string
  let sittingId: string
  let codeHash: string
  const beer = newId('nd')
  const gin = newId('nd')
  const lime = newId('nd')
  const soldOut = newId('nd')

  const menu: SendMenu = {
    currency: 'EUR',
    items: new Map([
      [
        beer,
        { priceMinor: 450, orderable: true, soldOut: false, name: 'Beer', options: new Map() },
      ],
      [
        gin,
        {
          priceMinor: 700,
          orderable: true,
          soldOut: false,
          name: 'Gin tonic',
          options: new Map([[lime, { deltaMinor: 50, name: 'Lime' }]]),
        },
      ],
      [
        soldOut,
        { priceMinor: 300, orderable: true, soldOut: true, name: 'Cola', options: new Map() },
      ],
    ]),
  }

  const guest = (located = true, now?: Date): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: `guest-${randomUUID()}`,
    tableCodeHash: codeHash,
    ...(located ? { sittingId, consentVersion: 'v1' } : {}),
    ...(now === undefined ? {} : { now }),
  })

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `jb-${randomUUID()}`,
  })

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

  interface Line {
    readonly id: string
    readonly itemId: string
    readonly optionIds: string[]
    readonly qty: number
    readonly note: string
    readonly removedAt: number | null
  }

  /** The order's live lines. */
  async function orderLines(): Promise<Line[]> {
    const { rows } = await world.owner.query(
      'select lines from restro.table_orders where table_id = $1 and sitting_id = $2',
      [tableId, sittingId],
    )
    const lines = (rows[0]?.lines ?? []) as Line[]
    return lines.filter((line) => line.removedAt === null)
  }

  /** A Send of the order's live lines as they stand. */
  async function send(
    options: {
      readonly actionId?: string
      readonly sendMenu?: SendMenu | null
      readonly now?: Date
    } = {},
  ) {
    const lines = (await orderLines()).map(({ itemId, optionIds, qty, note }) => ({
      itemId,
      optionIds,
      qty,
      note,
    }))
    const sendMenu = options.sendMenu === undefined ? menu : options.sendMenu
    return applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: options.actionId ?? randomUUID(),
        ageMs: 50,
        lines,
      },
      guest(true, options.now),
      sendMenu === null ? {} : { sendMenu },
    )
  }

  async function sentOrder(id: string) {
    const { rows } = await world.owner.query('select * from restro.sent_orders where id = $1', [id])
    return rows[0] as Record<string, unknown>
  }

  async function step(command: Record<string, unknown>) {
    return (await applyService(world.app, command, worker())).result
  }

  /** Takes the slot for the table's oldest waiting sent order. */
  async function start(): Promise<{ sentOrderId: string; fence: number }> {
    const result = await step({ type: 'sent_order.start', tableId })
    expect(result).toMatchObject({ status: 'accepted', details: { state: 'taken' } })
    return result.details as { sentOrderId: string; fence: number }
  }

  async function slot() {
    const { rows } = await world.owner.query(
      `select holder, fence from restro.locks where scope = 'order_slot' and key = $1`,
      [tableId],
    )
    return rows[0] as { holder: string | null; fence: number } | undefined
  }

  beforeAll(async () => {
    world = await openServiceWorld('send')
    tableId = world.tables[0] as string
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering}', $2::jsonb) where id = $1`,
      // The pace is #78's to test (send-guards.test.ts): these tests send many rounds on one table.
      [
        world.venueId,
        JSON.stringify({
          ...DEFAULT_ORDERING_SETTINGS,
          locationCheck: false,
          pacePer15Minutes: null,
        }),
      ],
    )
    // These tests send notes and options and open the POS bill with the first items; what a POS
    // that takes neither does is #78's (send-guards.test.ts).
    await world.declareCapabilities({ notesReachTicket: true, firstItemsOpenBill: true })
    const code = `code${randomUUID().replaceAll('-', '')}`
    codeHash = await hashTableCode(code)
    await world.owner.query(
      'update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1',
      [tableId, code, codeHash],
    )
  })

  afterAll(async () => {
    await world?.close()
  })

  beforeEach(async () => {
    // Each test starts on a fresh sitting, with no pause, no slot holder and nothing in flight.
    await world.owner.query(
      `update restro.sent_orders set state = 'not_sent', reason = 'test_reset', settled_at = now()
        where table_id = $1 and state in ('waiting', 'sending', 'checking')`,
      [tableId],
    )
    await world.owner.query(
      'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
      [tableId],
    )
    await world.owner.query(
      `update restro.locks set holder = null, deadline = null, released_at = now()
        where scope = 'order_slot' and key = $1`,
      [tableId],
    )
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where table_id = $1 and ended_at is null',
      [tableId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
  })

  it('takes the lines into a waiting sent order with a reference, notes apart, consent recorded', async () => {
    await add(beer, 2)
    await add(gin, 1, 'no ice', [lime])
    const { result } = await send()
    expect(result).toMatchObject({ status: 'accepted' })
    if (result.status !== 'accepted') return
    expect(result.ref).toMatch(/^[ACDEFHJKMNPQRTUVWXY34679]{3,4}$/)
    const id = result.details.sentOrderId as string
    expect(id).toMatch(/^so_/)
    expect(await orderLines()).toEqual([])

    const row = await sentOrder(id)
    expect(row).toMatchObject({
      state: 'waiting',
      reference: result.ref,
      sitting_id: sittingId,
      consent_version: 'v1',
      total_minor: String(2 * 450 + 750),
    })
    const lines = row.lines as Record<string, unknown>[]
    expect(lines).toMatchObject([
      { itemId: beer, qty: 2, unitMinor: 450, name: 'Beer', optionNames: [] },
      { itemId: gin, qty: 1, unitMinor: 750, name: 'Gin tonic', optionNames: ['Lime'] },
    ])
    // The note is never on the sent order itself (a waiter's alert never shows one).
    expect(JSON.stringify(lines)).not.toContain('no ice')
    const notes = await world.owner.query(
      'select line_id, note from restro.sent_order_notes where sent_order_id = $1',
      [id],
    )
    expect(notes.rows).toEqual([{ line_id: lines[1]?.id, note: 'no ice' }])
  })

  // Repair-review, hot spot 1 (D117: one shared bag, the server locks): many phones Send one bag
  // in the same second, one taps twice, and a friend adds a drink meanwhile. The bag's lines are
  // sent exactly once, and the added line is in the bag or in the round, never lost or doubled.
  it('sends the lines of one bag exactly once when many phones Send at once', async () => {
    for (let night = 0; night < 8; night += 1) {
      // A different quantity each night, so the duplicate guard (send-guards) stays out of it.
      const beers = night + 2
      await add(beer, beers)
      const before = await world.owner.query<{ n: string }>(
        'select count(*) as n from restro.sent_orders where sitting_id = $1',
        [sittingId],
      )
      const tapped = randomUUID()
      const answers = await Promise.all([
        send(),
        send(),
        send({ actionId: tapped }),
        send({ actionId: tapped }),
        send(),
        night % 2 === 0 ? add(gin, 1).then(() => null) : null,
        send(),
      ])
      const accepted = answers.flatMap((answer) =>
        answer !== null && answer.result.status === 'accepted'
          ? [answer.result.details.sentOrderId as string]
          : [],
      )
      // A friend's add can make every Send's lines out of date: then all are refused, and the
      // bag is untouched. Without the add, exactly one Send gets through.
      if (night % 2 === 1) expect(new Set(accepted).size).toBe(1)
      const { rows } = await world.owner.query<{
        id: string
        lines: { itemId: string; qty: number }[]
      }>(`select id, lines from restro.sent_orders where sitting_id = $1 order by created_at`, [
        sittingId,
      ])
      const sentNow = rows.slice(Number(before.rows[0]?.n ?? 0))
      expect(sentNow.map((row) => row.id).sort()).toEqual([...new Set(accepted)].sort())
      const quantity = (itemId: string, lines: readonly { itemId: string; qty: number }[]) =>
        lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0)
      const sentLines = sentNow.flatMap((row) => row.lines)
      const left = await orderLines()
      expect(quantity(beer, sentLines) + quantity(beer, left)).toBe(beers)
      expect(quantity(gin, sentLines) + quantity(gin, left)).toBe(night % 2 === 0 ? 1 : 0)
      // Clear what is left for the next night.
      for (const row of sentNow) {
        await world.owner.query(
          `update restro.sent_orders set state = 'added', settled_at = now() where id = $1`,
          [row.id],
        )
      }
      await world.owner.query(
        `update restro.table_orders set lines = '[]'::jsonb where table_id = $1 and sitting_id = $2`,
        [tableId, sittingId],
      )
    }
  }, 120_000)

  it('answers a repeated Send with its first answer, and makes one sent order', async () => {
    await add(beer, 1)
    const actionId = randomUUID()
    const first = await send({ actionId })
    const again = await applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId,
        ageMs: 50,
        lines: [{ itemId: beer, optionIds: [], qty: 1, note: '' }],
      },
      guest(),
      { sendMenu: menu },
    )
    expect(again.result).toEqual(first.result)
    const { rows } = await world.owner.query(
      'select count(*)::int as n from restro.sent_orders where action_id = $1',
      [actionId],
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('refuses while ordering is paused, without a menu, for a sold-out item or a changed order; the lines stay', async () => {
    await add(beer, 1)
    await add(soldOut, 1)
    const unavailable = await send()
    expect(unavailable.result).toMatchObject({
      status: 'refused',
      code: 'item_unavailable',
      details: { itemId: soldOut },
    })
    expect((await send({ sendMenu: null })).result).toMatchObject({ code: 'menu_unavailable' })

    const changed = await applyService(
      world.app,
      {
        type: 'order.send',
        tableId,
        actionId: randomUUID(),
        ageMs: 50,
        lines: [{ itemId: beer, optionIds: [], qty: 3, note: '' }],
      },
      guest(),
      { sendMenu: menu },
    )
    expect(changed.result).toMatchObject({ code: 'order_changed' })

    await world.owner.query(
      `insert into restro.pauses (id, tenant_id, venue_id, service_date, scope, target_id, cause,
         restro_started, details, source, actor, job_id)
       values ($1, $2, $3, current_date, 'venue', $3, 'staff_paused', false, '{}'::jsonb,
               'restro', 'system', 'test-seed')`,
      [newId('pa'), world.tenantId, world.venueId],
    )
    try {
      expect((await send()).result).toMatchObject({ code: 'ordering_paused' })
    } finally {
      await world.owner.query(
        'update restro.pauses set lifted_at = now() where target_id = $1 and lifted_at is null',
        [world.venueId],
      )
    }
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([
      [beer, 1],
      [soldOut, 1],
    ])
    const { rows } = await world.owner.query(
      'select count(*)::int as n from restro.sent_orders where sitting_id = $1',
      [sittingId],
    )
    expect(rows[0]?.n).toBe(0)
  })

  it('follows the service hours (#82): sends while open and in the last-orders notice, refuses before opening and after last orders; the lines stay', async () => {
    const night = { opens: '22:00', lastOrders: '04:30', closes: '05:30' }
    const hours = { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: night }
    await world.owner.query(
      `update restro.venues set settings = jsonb_set(settings, '{ordering,serviceHours}', $2::jsonb) where id = $1`,
      [world.venueId, JSON.stringify(hours)],
    )
    try {
      await add(beer, 1)
      // Friday 2026-10-23 (Sofia, UTC+3): opens 19:00Z, last orders 01:30Z next day.
      const refusedAt = async (iso: string) => (await send({ now: new Date(iso) })).result
      expect(await refusedAt('2026-10-23T18:59:00Z')).toMatchObject({ code: 'ordering_closed' })
      expect(await refusedAt('2026-10-24T01:30:00Z')).toMatchObject({ code: 'ordering_closed' })
      // Thursday night: a closed weekday.
      expect(await refusedAt('2026-10-22T20:00:00Z')).toMatchObject({ code: 'ordering_closed' })
      expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([[beer, 1]])

      const inNotice = await send({ now: new Date('2026-10-24T01:25:00Z') })
      expect(inNotice.result).toMatchObject({ status: 'accepted' })
      await add(gin, 1)
      expect((await send({ now: new Date('2026-10-23T20:00:00Z') })).result).toMatchObject({
        status: 'accepted',
      })
    } finally {
      await world.owner.query(
        `update restro.venues set settings = jsonb_set(settings, '{ordering,serviceHours}', $2::jsonb) where id = $1`,
        [world.venueId, JSON.stringify(DEFAULT_ORDERING_SETTINGS.serviceHours)],
      )
    }
  })

  it('takes the slot for one sent order at a time and settles it Added', async () => {
    await add(beer, 1)
    const one = (await send()).result.details.sentOrderId as string
    await add(gin, 1)
    const two = (await send()).result.details.sentOrderId as string

    const taken = await start()
    expect(taken.sentOrderId).toBe(one)
    expect(await step({ type: 'sent_order.start', tableId })).toMatchObject({
      details: { state: 'busy' },
    })
    const sending = { type: 'sent_order.transition', sentOrderId: one, fence: taken.fence }
    expect(await step({ ...sending, to: 'sending', billBeforeMinor: 1200 })).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    // A repeated job changes nothing; a stale fence is refused.
    expect(await step({ ...sending, to: 'sending' })).toMatchObject({ details: { changed: false } })
    expect(await step({ ...sending, fence: taken.fence + 99, to: 'checking' })).toMatchObject({
      code: 'lease_lost',
    })
    expect(
      await step({ ...sending, to: 'added', posBillRef: 'bill-1', matchedLines: ['l1'] }),
    ).toMatchObject({ details: { changed: true, state: 'added' } })
    expect(await sentOrder(one)).toMatchObject({
      state: 'added',
      bill_before_minor: '1200',
      pos_bill_ref: 'bill-1',
    })
    expect((await slot())?.holder).toBeNull()
    // Settled is settled.
    expect(await step({ ...sending, to: 'not_sent' })).toMatchObject({ code: 'sent_order_settled' })

    expect((await start()).sentOrderId).toBe(two)
  })

  it('gives the lines back, with their notes, when a sent order is Not sent', async () => {
    await add(gin, 2, 'no ice', [lime])
    const id = (await send()).result.details.sentOrderId as string
    const taken = await start()
    expect(
      await step({
        type: 'sent_order.transition',
        sentOrderId: id,
        fence: taken.fence,
        to: 'not_sent',
        reason: 'pos_refused',
      }),
    ).toMatchObject({ status: 'accepted' })
    expect(await sentOrder(id)).toMatchObject({ state: 'not_sent', reason: 'pos_refused' })
    expect(await orderLines()).toMatchObject([
      { itemId: gin, optionIds: [lime], qty: 2, note: 'no ice' },
    ])
    expect((await slot())?.holder).toBeNull()
  })

  it('flags the lines of run-out items when the POS refuses them, and gives every line back (#80)', async () => {
    await add(gin, 1)
    await add(beer, 2)
    const id = (await send()).result.details.sentOrderId as string
    const taken = await start()
    expect(
      await step({
        type: 'sent_order.transition',
        sentOrderId: id,
        fence: taken.fence,
        to: 'not_sent',
        reason: 'item_unavailable',
        outOfStock: [gin],
      }),
    ).toMatchObject({ status: 'accepted' })
    const stored = (await sentOrder(id)).lines as { itemId: string; outOfStock?: true }[]
    expect(stored.map((line) => [line.itemId, line.outOfStock ?? false])).toEqual([
      [gin, true],
      [beer, false],
    ])
    expect((await orderLines()).map((line) => [line.itemId, line.qty]).sort()).toEqual(
      [
        [gin, 1],
        [beer, 2],
      ].sort(),
    )
  })

  it('settles a sent order Not sent when its sitting ended, never handing the lines to the next group', async () => {
    await add(beer, 1)
    const id = (await send()).result.details.sentOrderId as string
    await world.owner.query(
      'update restro.sittings set ended_at = now(), end_reason = $2 where id = $1',
      [sittingId, 'staff_closed'],
    )
    sittingId = await world.openSitting(tableId)
    expect(await step({ type: 'sent_order.start', tableId })).toMatchObject({
      details: { state: 'settled', sentOrderId: id },
    })
    expect(await sentOrder(id)).toMatchObject({ state: 'not_sent', reason: 'table_closed' })
    expect(await orderLines()).toEqual([])
  })

  it('pauses the table on Unconfirmed, raises one alert and settles the orders behind it', async () => {
    await add(gin, 1, 'no ice', [lime])
    const first = await send()
    const one = first.result.details.sentOrderId as string
    await add(beer, 3)
    const two = (await send()).result.details.sentOrderId as string

    const taken = await start()
    const move = { type: 'sent_order.transition', sentOrderId: one, fence: taken.fence }
    await step({ ...move, to: 'sending', billBeforeMinor: 0 })
    await step({ ...move, to: 'checking' })
    expect(await step({ ...move, to: 'unconfirmed', reason: 'ambiguous' })).toMatchObject({
      status: 'accepted',
    })

    expect(await sentOrder(one)).toMatchObject({ state: 'unconfirmed', reason: 'ambiguous' })
    expect(await sentOrder(two)).toMatchObject({ state: 'not_sent', reason: 'ordering_paused' })
    expect((await orderLines()).map((line) => [line.itemId, line.qty])).toEqual([[beer, 3]])
    expect((await slot())?.holder).toBeNull()

    const pauses = await world.owner.query(
      'select cause, restro_started from restro.pauses where target_id = $1 and lifted_at is null',
      [tableId],
    )
    expect(pauses.rows).toEqual([{ cause: ORDER_UNCONFIRMED_CAUSE, restro_started: true }])
    const alerts = await world.owner.query(
      'select kind, audience, details from restro.alerts where subject_id = $1',
      [one],
    )
    expect(alerts.rows).toHaveLength(1)
    expect(alerts.rows[0]).toMatchObject({
      kind: ORDER_UNCONFIRMED_ALERT,
      audience: 'venue',
      details: {
        reference: first.result.status === 'accepted' ? first.result.ref : null,
        items: [{ name: 'Gin tonic', options: ['Lime'], qty: 1 }],
        billBeforeMinor: 0,
      },
    })
    expect(JSON.stringify(alerts.rows[0]?.details)).not.toContain('no ice')

    // Nothing more goes while the table is paused.
    expect((await send()).result).toMatchObject({ code: 'ordering_paused' })
  })

  it('expires a dead holder: Unconfirmed once it was sending, released while still waiting', async () => {
    await add(beer, 1)
    const id = (await send()).result.details.sentOrderId as string
    const expire = { type: 'sent_order.expire', tableId }
    const lapse = () =>
      world.owner.query(
        `update restro.locks set deadline = now() - interval '1 second'
          where scope = 'order_slot' and key = $1`,
        [tableId],
      )

    let taken = await start()
    expect(await step(expire)).toMatchObject({ details: { expired: false } })
    await lapse()
    expect(await step(expire)).toMatchObject({ details: { expired: true, released: true } })
    expect(await sentOrder(id)).toMatchObject({ state: 'waiting' })

    taken = await start()
    await step({
      type: 'sent_order.transition',
      sentOrderId: id,
      fence: taken.fence,
      to: 'sending',
    })
    await lapse()
    expect(await step(expire)).toMatchObject({ details: { expired: true, sentOrderId: id } })
    expect(await sentOrder(id)).toMatchObject({ state: 'unconfirmed', reason: 'check_timed_out' })
  })
})
