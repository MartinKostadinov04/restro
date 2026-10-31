// The end of a service day clears the night's open alerts (#162; Martin 10-27) on a real Postgres,
// as the restro_app role: every open venue alert of the closing day is Done in the close's own
// transaction with one `alert.cleared` Log entry each, except a pause (it ends by itself), a
// payment question only an answer closes (never Done, #112), a money alert (repeated until Done,
// D122 §7) and Restro's own alerts. A Done by staff, another day's
// alert and another venue's are left alone, and a close that is refused clears nothing. Skipped
// without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceContext } from './context'
import { applyService } from './index'

const DAY = '2026-02-10'
const OTHER_DAY = '2026-02-09'
const REFUSED_DAY = '2026-02-11'

describe.skipIf(!hasDatabase)('closing a service day clears its open alerts (restro_app)', () => {
  let world: ServiceWorld
  let elsewhere: ServiceWorld
  let ownerId: string

  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `day-close-alerts-${randomUUID()}`,
  })
  const close = async (day: string) =>
    (await applyService(world.app, { type: 'service_day.close', serviceDate: day }, worker()))
      .result

  async function seed(
    kind: string,
    day: string,
    options: {
      audience?: 'venue' | 'restro'
      in?: ServiceWorld
      doneBy?: string
      telegramRef?: string
    } = {},
  ): Promise<string> {
    const target = options.in ?? world
    const id = newId('al')
    await target.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          telegram_message_ref, done_at, done_by, via, next_repeat_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, $7, 'alerts.answer', '{"reference":"K7Q"}'::jsonb, $8,
               $9, $10, $11, now() + interval '10 minutes', 'restro', 'system', 'test-seed')`,
      [
        id,
        target.tenantId,
        target.venueId,
        day,
        kind,
        options.audience ?? 'venue',
        newId('so'),
        options.telegramRef ?? null,
        options.doneBy === undefined ? null : new Date('2026-02-10T23:00:00Z'),
        options.doneBy ?? null,
        options.doneBy === undefined ? null : 'tonight',
      ],
    )
    return id
  }
  const alertRow = async (id: string, from: ServiceWorld = world) =>
    (
      await from.owner.query<{
        done_at: Date | null
        done_by: string | null
        via: string | null
        next_repeat_at: Date | null
        details: Record<string, unknown>
      }>('select done_at, done_by, via, next_repeat_at, details from restro.alerts where id = $1', [
        id,
      ])
    ).rows[0]
  const clearedLog = async (from: ServiceWorld = world) =>
    (
      await from.owner.query<{
        reason: string
        details: Record<string, unknown>
        via: string | null
        retention: string
        service_date: string
      }>(
        `select reason, details, via, retention, service_date::text as service_date
           from restro.log_entries
          where venue_id = $1 and kind = 'alert.cleared'
          order by reason, seq`,
        [from.venueId],
      )
    ).rows

  beforeAll(async () => {
    world = await openServiceWorld('day-close-alerts')
    elsewhere = await openServiceWorld('day-close-alerts-other')
    ownerId = await world.addUser('owner')
  })

  afterAll(async () => {
    await world?.close()
    await elsewhere?.close()
  })

  let unconfirmed: string
  let outOfStock: string
  let checkFailed: string
  let paymentUnconfirmed: string
  let linesNotBack: string
  let paused: string
  let restroOwn: string
  let answered: string
  let otherDay: string
  let otherVenue: string

  it('leaves everything open when the close is refused', async () => {
    const today = (
      await world.owner.query<{ today: string }>(
        `select to_char(now() at time zone v.timezone, 'YYYY-MM-DD') as today
           from restro.venues v where v.id = $1`,
        [world.venueId],
      )
    ).rows[0]?.today as string
    const refusedAlert = await seed('order_unconfirmed', REFUSED_DAY)
    const todayAlert = await seed('order_unconfirmed', today)
    // A sent order of the day still waiting for its slot: `orders_open`.
    const [table] = world.tables as [string]
    const sitting = await world.openSitting(table, REFUSED_DAY)
    await world.addSentOrder({
      tableId: table,
      sittingId: sitting,
      actionId: randomUUID(),
      reference: 'WAIT',
      serviceDate: REFUSED_DAY,
    })
    expect(await close(REFUSED_DAY)).toMatchObject({ status: 'refused', code: 'orders_open' })
    expect(await close(today)).toMatchObject({ status: 'refused', code: 'day_not_ended' })
    expect((await alertRow(refusedAlert))?.done_at).toBeNull()
    expect((await alertRow(todayAlert))?.done_at).toBeNull()
    expect(await clearedLog()).toEqual([])
  })

  it('clears the day’s open venue alerts, one Log entry each, and no others', async () => {
    unconfirmed = await seed('order_unconfirmed', DAY, { telegramRef: '-100:77' })
    outOfStock = await seed('item_out_of_stock', DAY)
    checkFailed = await seed('payment_check_failed', DAY)
    paymentUnconfirmed = await seed('payment_unconfirmed', DAY)
    linesNotBack = await seed('payment_lines_not_back', DAY)
    paused = await seed('ordering_paused', DAY)
    restroOwn = await seed('order_rate', DAY, { audience: 'restro' })
    answered = await seed('order_unconfirmed', DAY, { doneBy: `user:${ownerId}` })
    otherDay = await seed('order_unconfirmed', OTHER_DAY)
    otherVenue = await seed('order_unconfirmed', DAY, { in: elsewhere })
    const answeredBefore = await alertRow(answered)

    expect(await close(DAY)).toMatchObject({
      status: 'accepted',
      details: { changed: true, alertsCleared: 2 },
    })

    for (const id of [unconfirmed, outOfStock]) {
      expect(await alertRow(id)).toMatchObject({
        via: 'worker',
        done_by: 'system',
        next_repeat_at: null,
        details: { clearedAt: 'day_close' },
      })
      expect((await alertRow(id))?.done_at).not.toBeNull()
    }
    // The delivery state and the other details stay with the alert.
    expect((await alertRow(unconfirmed))?.details).toMatchObject({ reference: 'K7Q' })

    for (const id of [paymentUnconfirmed, linesNotBack, checkFailed, paused, restroOwn, otherDay]) {
      expect(await alertRow(id)).toMatchObject({ done_at: null, via: null })
    }
    expect((await alertRow(otherVenue, elsewhere))?.done_at).toBeNull()
    // A Done by staff is untouched and gets no second Log line.
    expect(await alertRow(answered)).toEqual(answeredBefore)

    const log = await clearedLog()
    expect(log).toEqual([
      expect.objectContaining({ reason: 'item_out_of_stock', details: expect.anything() }),
      expect.objectContaining({ reason: 'order_unconfirmed' }),
    ])
    expect(
      log
        .map((entry) => entry.details)
        .sort((a, b) => `${a.alertId}`.localeCompare(`${b.alertId}`)),
    ).toEqual(
      [unconfirmed, outOfStock]
        .sort((a, b) => a.localeCompare(b))
        .map((alertId) => ({ alertId, at: 'day_close' })),
    )
    for (const entry of log) {
      expect(entry).toMatchObject({ via: 'worker', retention: 'night', service_date: DAY })
    }
    expect(await clearedLog(elsewhere)).toEqual([])
  })

  it('keeps counting the cleared alerts in the day’s totals', async () => {
    const [day] = (
      await world.owner.query<{ totals: Record<string, number> }>(
        'select totals from restro.service_days where venue_id = $1 and service_date = $2',
        [world.venueId, DAY],
      )
    ).rows
    // Every alert row of the day counts: cleared or not, Done by staff, Restro's own.
    expect(day?.totals.alerts).toBe(8)
  })

  it('leaves a payment question open to be answered the next day, never by Done (#112)', async () => {
    expect((await alertRow(paymentUnconfirmed))?.done_at).toBeNull()
    const doneToday = await applyService(
      world.app,
      { type: 'alert.done', alertId: paymentUnconfirmed },
      {
        tenantId: world.tenantId,
        venueId: world.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: ownerId, sessionId: 'session-1' },
        jobId: `day-close-alerts-${randomUUID()}`,
        via: 'tonight',
      },
    )
    // Only the payment's answer closes it (pay.test.ts, payment-route.test.ts).
    expect(doneToday.result).toMatchObject({ status: 'refused', code: 'alert_needs_answer' })
    expect((await alertRow(paymentUnconfirmed))?.done_at).toBeNull()
  })

  it('does nothing more when the day is closed again', async () => {
    expect(await close(DAY)).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect(await clearedLog()).toHaveLength(2)
  })
})
