// The end of a service day (#84; D111, design §4) on a real Postgres, as the restro_app role: an
// ended day's sittings and sent orders are kept 18 months from now, never less than they were;
// its sent orders' action ids are cleared; `service_days` keeps its totals with one Log entry; a
// repeat changes nothing; today's day is refused and only the worker may close a day, and a day
// waits while a payment or a sent order of it is still moving. Rows of other days are left alone.
// Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { serviceDate } from '../service-day'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'
import { recordRetainUntil } from './log'

const CLOSED_DAY = '2026-01-10'
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

describe.skipIf(!hasDatabase)('closing a service day (as the restro_app role)', () => {
  let world: ServiceWorld
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `service-day-test-${randomUUID()}`,
  })
  const close = async (day: string, context: ServiceContext = worker()) =>
    (await applyService(world.app, { type: 'service_day.close', serviceDate: day }, context)).result
  const rows = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await world.owner.query(text, values)).rows as T[]

  /** A sitting of `day` that has ended. */
  async function endedSitting(tableId: string, day: string): Promise<string> {
    const id = await world.openSitting(tableId, day)
    await world.owner.query(
      `update restro.sittings set ended_at = now(), end_reason = 'staff_closed' where id = $1`,
      [id],
    )
    return id
  }

  let today: string
  let sittingA: string
  let sittingB: string
  let sentA: string
  let sentB: string
  let sentLongKept: string
  let sentToday: string
  let heldPayment: string
  const todayAction = randomUUID()

  beforeAll(async () => {
    world = await openServiceWorld('service-day')
    const [venue] = await rows<{ timezone: string; ends: string }>(
      'select timezone, service_day_ends_at::text as ends from restro.venues where id = $1',
      [world.venueId],
    )
    today = serviceDate(new Date(), venue?.timezone ?? '', venue?.ends ?? '')
    const [t1, t2, t3] = world.tables as [string, string, string]
    sittingA = await endedSitting(t1, CLOSED_DAY)
    sittingB = await endedSitting(t2, CLOSED_DAY)
    sentA = await world.addSentOrder({
      tableId: t1,
      sittingId: sittingA,
      actionId: randomUUID(),
      reference: 'AAA',
      serviceDate: CLOSED_DAY,
    })
    sentB = await world.addSentOrder({
      tableId: t2,
      sittingId: sittingB,
      actionId: randomUUID(),
      reference: 'BBB',
      serviceDate: CLOSED_DAY,
    })
    sentLongKept = await world.addSentOrder({
      tableId: t2,
      sittingId: sittingB,
      actionId: randomUUID(),
      reference: 'CCC',
      serviceDate: CLOSED_DAY,
    })
    await world.owner.query(
      `update restro.sent_orders set state = 'added', retain_until = now() - interval '1 day'
        where id = $1`,
      [sentA],
    )
    await world.owner.query(`update restro.sent_orders set state = 'not_sent' where id = $1`, [
      sentB,
    ])
    // A row an earlier write gave a longer life keeps it.
    await world.owner.query(
      `update restro.sent_orders set retain_until = '2040-01-01T00:00:00Z', landing_basis = '{}'::jsonb
        where id = $1`,
      [sentLongKept],
    )
    // A card held at the day's end: the payment goes on after it.
    heldPayment = `py_${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          action_id, amount_minor, tip_minor, currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'held', $7, $8, 1200, 200, 'EUR', 'sim',
               'guest', 'guest', 'test-seed')`,
      [
        heldPayment,
        world.tenantId,
        world.venueId,
        t1,
        sittingA,
        CLOSED_DAY,
        createHash('sha256').update(randomUUID()).digest('hex'),
        randomUUID(),
      ],
    )
    const sittingToday = await world.openSitting(t3)
    sentToday = await world.addSentOrder({
      tableId: t3,
      sittingId: sittingToday,
      actionId: todayAction,
      reference: 'DDD',
    })
  })

  afterAll(async () => {
    await world?.close()
  })

  it('refuses a day that has not ended, and anyone but the worker', async () => {
    expect(await close(today)).toMatchObject({ status: 'refused', code: 'day_not_ended' })
    const owner = await world.addUser('owner')
    expect(
      await close(CLOSED_DAY, {
        ...worker(),
        origin: 'staff',
        actor: { kind: 'user', userId: owner, sessionId: 'session-test' },
        via: 'tonight',
      }),
    ).toMatchObject({ status: 'refused', code: 'origin_not_allowed' })
    expect(
      await rows('select 1 from restro.service_days where venue_id = $1', [world.venueId]),
    ).toEqual([])
  })

  it('waits while a payment or a sent order of the day is still moving', async () => {
    expect(await close(CLOSED_DAY)).toMatchObject({ status: 'refused', code: 'payments_open' })
    await world.owner.query(
      `update restro.payments set state = 'captured', captured_minor = 1200, settled_at = now()
        where id = $1`,
      [heldPayment],
    )
    // sentLongKept is still waiting for its slot.
    expect(await close(CLOSED_DAY)).toMatchObject({ status: 'refused', code: 'orders_open' })
    await world.owner.query(
      `update restro.sent_orders set state = 'unconfirmed', reason = 'no_answer' where id = $1`,
      [sentLongKept],
    )
    expect(
      await rows('select 1 from restro.service_days where venue_id = $1', [world.venueId]),
    ).toEqual([])
    const [payment] = await rows<{ action_id: string | null }>(
      'select action_id from restro.payments where id = $1',
      [heldPayment],
    )
    expect(payment?.action_id).not.toBeNull()
  })

  it('keeps the day 18 months, clears its action ids and keeps its totals', async () => {
    const before = Date.now()
    expect(await close(CLOSED_DAY)).toMatchObject({
      status: 'accepted',
      details: { changed: true, sittings: 2, sentOrders: 3, payments: 1 },
    })
    const floor = recordRetainUntil(new Date(before)).getTime()

    const kept = await rows<{ id: string; retain_until: Date }>(
      'select id, retain_until from restro.sittings where id = any($1)',
      [[sittingA, sittingB]],
    )
    expect(kept).toHaveLength(2)
    for (const row of kept) expect(row.retain_until.getTime()).toBeGreaterThanOrEqual(floor)

    const sent = await rows<{
      id: string
      action_id: string | null
      retain_until: Date
      landing_basis: unknown
    }>(
      'select id, action_id, retain_until, landing_basis from restro.sent_orders where id = any($1)',
      [[sentA, sentB, sentLongKept]],
    )
    for (const row of sent) {
      expect(row.action_id).toBeNull()
      // A late landing is matched within the day only (#135): its reading goes with the day.
      expect(row.landing_basis).toBeNull()
      expect(row.retain_until.getTime()).toBeGreaterThanOrEqual(floor)
    }
    expect(sent.find((row) => row.id === sentLongKept)?.retain_until.toISOString()).toBe(
      '2040-01-01T00:00:00.000Z',
    )
    const [payment] = await rows<{ action_id: string | null }>(
      'select action_id from restro.payments where id = $1',
      [heldPayment],
    )
    expect(payment?.action_id).toBeNull()
    // About 18 months, not more: the column moved to the day's record life, no further.
    const moved = sent.find((row) => row.id === sentA)?.retain_until.getTime() ?? 0
    expect(moved).toBeLessThan(Date.now() + 19 * MONTH_MS)

    const [day] = await rows<{ totals: Record<string, number>; mismatches: number }>(
      'select totals, mismatches from restro.service_days where venue_id = $1 and service_date = $2',
      [world.venueId, CLOSED_DAY],
    )
    expect(day?.totals).toMatchObject({
      sittings: 2,
      sentOrders: 3,
      sentOrdersAdded: 1,
      sentOrdersNotSent: 1,
      sentOrdersUnconfirmed: 1,
      addedMinor: 500,
      waiterCalls: 0,
      payments: 1,
      capturedMinor: 1200,
      tipMinor: 200,
    })
    expect(day?.mismatches).toBe(0)
    const logged = await rows<{ details: Record<string, unknown>; retention: string }>(
      `select details, retention from restro.log_entries
        where venue_id = $1 and kind = 'service_day.closed'`,
      [world.venueId],
    )
    expect(logged).toEqual([
      { details: { closedDate: CLOSED_DAY, sittings: 2, sentOrders: 3 }, retention: 'night' },
    ])
  })

  it('leaves the other days alone', async () => {
    const [row] = await rows<{ action_id: string | null }>(
      'select action_id from restro.sent_orders where id = $1',
      [sentToday],
    )
    expect(row?.action_id).toBe(todayAction)
  })

  it('changes nothing when the day is closed again', async () => {
    const [before] = await rows<{ retain_until: Date }>(
      'select retain_until from restro.sittings where id = $1',
      [sittingA],
    )
    expect(await close(CLOSED_DAY)).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    const [after] = await rows<{ retain_until: Date }>(
      'select retain_until from restro.sittings where id = $1',
      [sittingA],
    )
    expect(after?.retain_until.getTime()).toBe(before?.retain_until.getTime())
    expect(
      await rows(
        `select 1 from restro.log_entries where venue_id = $1 and kind = 'service_day.closed'`,
        [world.venueId],
      ),
    ).toHaveLength(1)
  })
})
