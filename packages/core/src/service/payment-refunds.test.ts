// Refunds and disputes read back from the provider (#222, #261; D122 §8, decision log 5.2–5.11) on a
// real Postgres as the restro_app role: each refund the provider lists is one refund row, by its id,
// with one Log entry and one amount-free alert for the group; a repeat raises nothing; a refund the
// list says failed marks its row "didn't go through"; rows and totals from before the ids are not
// counted twice; "Storno done" records who
// and when, is refused a second time, and is taken back by its Undo; a dispute records when it
// opened and when it closed, the answer-by date and the retention; Tonight reads the to-dos for
// managers and the shared tablet and not for a waiter. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { provisionVenue } from '../apply/provision'
import { createArea, createTable } from '../apply/tables'
import { hasDatabase, testSlug } from '../apply/test-database'
import { newId } from '../ids'
import { STAFF_UNDO_WINDOW_MS } from '../table-order'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import {
  applyService,
  readLog,
  readNightPayments,
  readPaymentDetail,
  readTonight,
  type ServiceCommand,
} from './index'
import { disputeRetainUntil } from './payment-observe'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'

type Listed = { ref: string; amountMinor: number; failed: boolean }

describe('how long a closed dispute keeps its payment', () => {
  it('is six months, to the day (D122 §8)', () => {
    expect(disputeRetainUntil(new Date('2026-03-15T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-15T10:00:00.000Z',
    )
  })
})

describe.skipIf(!hasDatabase)('refunds and disputes (as the restro_app role)', () => {
  let world: ServiceWorld
  let managerId: string
  let staffUserId: string
  let deviceUserId: string
  const deviceSession = `device-${randomUUID()}`

  beforeAll(async () => {
    world = await openServiceWorld('refunds')
    managerId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.manager, managerId)
    staffUserId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, staffUserId)
    deviceUserId = await world.addUser('member')
    await world.addSharedDevice(deviceSession)
  })
  afterAll(async () => {
    await world?.close()
  })

  const context = (actor: ServiceActor, origin: ServiceContext['origin'] = 'staff') =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin,
      actor,
      jobId: `refund-${randomUUID()}`,
      ...(origin === 'staff' ? { via: 'tonight' } : { via: 'provider' }),
    }) as ServiceContext
  const user = (userId: string): ServiceActor => ({ kind: 'user', userId, sessionId: 'session-1' })
  const run = async (command: unknown, ctx: ServiceContext) =>
    (await applyService(world.app, command as ServiceCommand, ctx)).result
  const worker = () => context({ kind: 'system' }, 'worker')

  async function sitting(): Promise<{ id: string; day: string; table: string }> {
    const table = world.tables[0] as string
    const open = await world.owner.query(
      'select id, service_date::text as day from restro.sittings where table_id = $1 and ended_at is null',
      [table],
    )
    const found =
      (open.rows[0] as { id: string; day: string } | undefined) ??
      (
        await world.owner.query(
          'select id, service_date::text as day from restro.sittings where id = $1',
          [await world.openSitting(table)],
        )
      ).rows[0]
    return { ...found, table }
  }

  /** A captured card payment of 20.00 with the POS's receipt and fiscal memory numbers. */
  async function captured(
    retainUntil: string | null = null,
    options: { tipMinor?: number; refundedMinor?: number } = {},
  ): Promise<{ id: string; ref: string }> {
    const s = await sitting()
    const id = newId('py')
    const ref = `simpay_${randomUUID().replaceAll('-', '')}`
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
          amount_minor, tip_minor, captured_minor, refunded_minor, currency, provider_kind, provider_payment_ref,
          receipt_number, fiscal_memory_number, settled_at, retain_until, source, actor, job_id)
       values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', $7, 2000, $10, 2000, $11, 'EUR', 'sim-pay',
               $8, 'R-000777', 'FM-12345', now(), $9::timestamptz, 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        s.table,
        s.id,
        s.day,
        createHash('sha256').update(id).digest('hex'),
        ref,
        retainUntil,
        options.tipMinor ?? 0,
        options.refundedMinor ?? 0,
      ],
    )
    return { id, ref }
  }
  /** A refund as the provider lists it; its id comes from its amount unless named. */
  const made = (amountMinor: number, ref = `re_${amountMinor}`): Listed => ({
    ref,
    amountMinor,
    failed: false,
  })
  const failedAtProvider = (amountMinor: number, ref = `re_${amountMinor}`): Listed => ({
    ref,
    amountMinor,
    failed: true,
  })
  const observe = (
    target: { id: string; ref: string },
    reading: {
      refunds: readonly Listed[] | null
      dispute?: 'open' | 'won' | 'lost' | null
      disputeDueAt?: string | null
    },
  ) => ({
    type: 'payment.observe',
    paymentId: target.id,
    providerKind: 'sim-pay',
    providerPaymentRef: target.ref,
    capturedMinor: 2_000,
    dispute: null,
    disputeDueAt: null,
    ...reading,
  })
  const stored = async (id: string) =>
    (
      await world.owner.query<{ refunded_minor: string }>(
        'select refunded_minor from restro.payments where id = $1',
        [id],
      )
    ).rows[0] as { refunded_minor: string }
  const refundRows = async (paymentId: string) =>
    (
      await world.owner.query<{
        id: string
        provider_refund_ref: string | null
        amount_minor: string
        failed_at: Date | null
        storno_at: Date | null
        storno_by: string | null
        service_date: string
      }>(
        `select id, provider_refund_ref, amount_minor, failed_at, storno_at, storno_by, service_date::text
           from restro.payment_refunds where payment_id = $1 order by seen_at, id`,
        [paymentId],
      )
    ).rows
  const alertsOf = async (paymentId: string, kind: string) =>
    (
      await world.owner.query<{
        id: string
        done_at: Date | null
        details: Record<string, unknown>
      }>(
        'select id, done_at, details from restro.alerts where subject_id = $1 and kind = $2 order by raised_at, id',
        [paymentId, kind],
      )
    ).rows
  const logKinds = async (paymentId: string, kind: string) =>
    (
      await world.owner.query<{ to_state: string | null; details: Record<string, unknown> }>(
        'select to_state, details from restro.log_entries where payment_id = $1 and kind = $2 order by seq',
        [paymentId, kind],
      )
    ).rows

  it('makes one refund row, one Log entry and one amount-free alert for a refund, and a repeat none', async () => {
    const target = await captured()
    const first = await run(observe(target, { refunds: [made(500)] }), worker())
    expect(first).toMatchObject({ status: 'accepted', details: { changed: true, refundsAdded: 1 } })
    const rows = await refundRows(target.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount_minor: '500', failed_at: null, storno_at: null })

    const alerts = await alertsOf(target.id, 'payment_refunded')
    expect(alerts).toHaveLength(1)
    // The group is told the table and the day, never an amount (decision log 5.8).
    expect(JSON.stringify(alerts[0]?.details)).not.toMatch(/500|amount/i)
    // The provider's id stays on the row (rule 3).
    expect(rows[0]?.provider_refund_ref).toBe('re_500')
    expect(JSON.stringify(await logKinds(target.id, 'payment.refund_seen'))).not.toContain('re_500')
    expect(alerts[0]?.details).toMatchObject({ refundId: rows[0]?.id, providerKind: 'sim-pay' })
    expect(await logKinds(target.id, 'payment.refund_seen')).toMatchObject([
      { to_state: 'seen', details: { amountMinor: 500, refundId: rows[0]?.id } },
    ])

    // The same reading again (a notice that comes twice) raises nothing new.
    expect(await run(observe(target, { refunds: [made(500)] }), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await refundRows(target.id)).toHaveLength(1)
    expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(1)
  })

  /** All a reading can touch of a payment: a repeat must leave it exactly as it was. */
  const picture = async (paymentId: string) => {
    const rows = await world.owner.query(
      'select to_jsonb(t) as row from restro.payment_refunds t where payment_id = $1 order by id',
      [paymentId],
    )
    return JSON.stringify({
      total: (await stored(paymentId)).refunded_minor,
      rows: rows.rows,
      alerts: await alertsOf(paymentId, 'payment_refunded'),
      log: await logKinds(paymentId, 'payment.refund_seen'),
    })
  }
  const amounts = async (paymentId: string) =>
    (await refundRows(paymentId)).map((r) => [
      r.provider_refund_ref,
      r.amount_minor,
      r.failed_at !== null,
    ])

  it('makes one row for each refund, also for two read back at once', async () => {
    const target = await captured()
    await run(observe(target, { refunds: [made(500)] }), worker())
    await run(observe(target, { refunds: [made(500), made(700)] }), worker())
    expect((await refundRows(target.id)).map((r) => r.amount_minor)).toEqual(['500', '700'])
    expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(2)
    expect((await stored(target.id)).refunded_minor).toBe('1200')

    // Two refunds that happened before the worker looked stay two.
    const batch = await captured()
    await run(observe(batch, { refunds: [made(500), made(1_000)] }), worker())
    expect(
      (await refundRows(batch.id)).map((r) => Number(r.amount_minor)).toSorted((x, y) => x - y),
    ).toEqual([500, 1_000])
    expect(await alertsOf(batch.id, 'payment_refunded')).toHaveLength(2)
  })

  it('marks the row of the refund that failed, by its id', async () => {
    const target = await captured()
    await run(observe(target, { refunds: [made(500)] }), worker())
    await run(observe(target, { refunds: [made(500), made(300)] }), worker())
    expect(
      await run(observe(target, { refunds: [failedAtProvider(500), made(300)] }), worker()),
    ).toMatchObject({
      status: 'accepted',
      details: { refundsFailed: 1, refundsAdded: 0, refundsUnmatched: 0 },
    })
    expect(await amounts(target.id)).toEqual([
      ['re_500', '500', true],
      ['re_300', '300', false],
    ])
    expect((await stored(target.id)).refunded_minor).toBe('300')
    const alerts = await alertsOf(target.id, 'payment_refunded')
    expect(alerts.map((a) => a.done_at !== null)).toEqual([true, false])
    expect(await logKinds(target.id, 'payment.refund_seen')).toMatchObject([
      { to_state: 'seen' },
      { to_state: 'seen' },
      { to_state: 'failed', details: { amountMinor: 500 } },
    ])
    // A new refund of the same amount: a new row, not the failed one back.
    await run(
      observe(target, { refunds: [failedAtProvider(500), made(300), made(500, 're_again')] }),
      worker(),
    )
    expect(await amounts(target.id)).toEqual([
      ['re_500', '500', true],
      ['re_300', '300', false],
      ['re_again', '500', false],
    ])
  })

  // The ticket's case (RR-1): the total stays 500, so a total can't tell that anything happened.
  it('counts a failed refund and a new one of the same amount in one reading, and a repeat changes nothing', async () => {
    const target = await captured()
    await run(observe(target, { refunds: [made(500, 're_a')] }), worker())
    const reading = observe(target, {
      refunds: [failedAtProvider(500, 're_a'), made(500, 're_b')],
    })
    expect(await run(reading, worker())).toMatchObject({
      status: 'accepted',
      details: { changed: true, refundsFailed: 1, refundsAdded: 1, refundsUnmatched: 0 },
    })
    expect(await amounts(target.id)).toEqual([
      ['re_a', '500', true],
      ['re_b', '500', false],
    ])
    expect((await stored(target.id)).refunded_minor).toBe('500')
    expect((await alertsOf(target.id, 'payment_refunded')).map((a) => a.done_at !== null)).toEqual([
      true,
      false,
    ])

    const before = await picture(target.id)
    expect(await run(reading, worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await picture(target.id)).toBe(before)
  })

  it('tells a failed refund and a new one apart, whatever their amounts', async () => {
    // Read as one total, this was a rise of 300 and the 500 stayed.
    const larger = await captured()
    await run(observe(larger, { refunds: [made(500)] }), worker())
    await run(observe(larger, { refunds: [failedAtProvider(500), made(800)] }), worker())
    expect(await amounts(larger.id)).toEqual([
      ['re_500', '500', true],
      ['re_800', '800', false],
    ])
    // Read as one total, this was a fall by 200 no row had, and the new refund got no row.
    const smaller = await captured()
    await run(observe(smaller, { refunds: [made(500)] }), worker())
    await run(observe(smaller, { refunds: [failedAtProvider(500), made(300)] }), worker())
    expect(await amounts(smaller.id)).toEqual([
      ['re_500', '500', true],
      ['re_300', '300', false],
    ])
    expect((await stored(smaller.id)).refunded_minor).toBe('300')
  })

  it('makes no row for a refund that failed before it was ever read', async () => {
    const target = await captured()
    const answer = await run(observe(target, { refunds: [failedAtProvider(500)] }), worker())
    expect(answer).toMatchObject({ status: 'accepted', details: { changed: false } })
    expect(await refundRows(target.id)).toEqual([])
    expect(await alertsOf(target.id, 'payment_refunded')).toEqual([])
  })

  it('leaves a row the list contradicts, says so, and still sees a new refund', async () => {
    const target = await captured()
    await run(observe(target, { refunds: [made(500)] }), worker())
    await run(observe(target, { refunds: [made(500), made(300)] }), worker())
    // The 300 is gone from the list: not documented, and absence marks nothing.
    expect(await run(observe(target, { refunds: [made(500)] }), worker())).toMatchObject({
      status: 'accepted',
      details: { refundsFailed: 0, refundsAdded: 0, refundsUnmatched: 1 },
    })
    expect(await amounts(target.id)).toEqual([
      ['re_500', '500', false],
      ['re_300', '300', false],
    ])
    // The stored total follows the list.
    expect((await stored(target.id)).refunded_minor).toBe('500')

    // A refund back after it failed: not documented; its row stays marked, and it can't stand for
    // a later refund.
    const back = await captured()
    await run(observe(back, { refunds: [made(500)] }), worker())
    await run(observe(back, { refunds: [failedAtProvider(500)] }), worker())
    expect(await run(observe(back, { refunds: [made(500)] }), worker())).toMatchObject({
      status: 'accepted',
      details: { refundsUnmatched: 1 },
    })
    await run(observe(back, { refunds: [made(500), made(200)] }), worker())
    expect(await amounts(back.id)).toEqual([
      ['re_500', '500', true],
      ['re_200', '200', false],
    ])
  })

  it('refuses a list that adds up to more than was captured, and changes nothing', async () => {
    const target = await captured()
    expect(
      await run(observe(target, { refunds: [made(1_500), made(600)] }), worker()),
    ).toMatchObject({
      status: 'refused',
      code: 'payment_mismatch',
      details: { reason: 'captured_amount' },
    })
    expect(await refundRows(target.id)).toEqual([])
    expect((await stored(target.id)).refunded_minor).toBe('0')
  })

  it('leaves the refunds as they are on a reading with no list', async () => {
    const target = await captured()
    await run(observe(target, { refunds: [made(500)] }), worker())
    const before = await picture(target.id)
    expect(await run(observe(target, { refunds: null, dispute: 'open' }), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: true, refundedMinor: 500, dispute: 'open' },
    })
    expect(await picture(target.id)).toBe(before)
  })

  // Hot spot 10 (RR-1): each row is a storno to-do, so what is still to storno must be what the
  // provider says was refunded, after every reading, whatever happened between two readings: the
  // venue's refunds made and failed, in any batch.
  it('keeps the active refund rows adding up to the provider’s total after every reading', async () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant('made' as const), minor: fc.constantFrom(100, 200, 300, 500) }),
      fc.record({ kind: fc.constant('failed' as const), which: fc.nat({ max: 5 }) }),
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(op, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 4 }),
        async (readings) => {
          const target = await captured()
          const refunds: Listed[] = []
          const active = () => refunds.filter((refund) => !refund.failed)
          const total = () => active().reduce((sum, refund) => sum + refund.amountMinor, 0)
          for (const reading of readings) {
            for (const event of reading) {
              if (event.kind === 'made' && total() + event.minor <= 2_000) {
                refunds.push(made(event.minor, `re_${refunds.length}`))
              }
              const going = active()
              if (event.kind === 'failed' && going.length > 0) {
                ;(going[event.which % going.length] as Listed).failed = true
              }
            }
            await run(observe(target, { refunds: refunds.map((r) => ({ ...r })) }), worker())
            const rows = (await refundRows(target.id)).filter((row) => row.failed_at === null)
            expect(rows.reduce((sum, row) => sum + Number(row.amount_minor), 0)).toBe(total())
          }
        },
      ),
      {
        numRuns: 40,
        // The claim's case: a 500 refund made, then it fails and a new 100 is made before the next
        // reading. The to-do stays 500; the provider's total is 100.
        examples: [
          [
            [
              [{ kind: 'made', minor: 500 }],
              [
                { kind: 'failed', which: 0 },
                { kind: 'made', minor: 100 },
              ],
            ],
          ],
        ],
      },
    )
  }, 120_000)

  describe('rows and totals from before the ids (migration 0044)', () => {
    /** The rows the old reading left, one per rise of the total, with no id and no new alert. */
    async function oldRows(target: { id: string }, rises: readonly number[]): Promise<void> {
      const [{ day } = { day: '' }] = (
        await world.owner.query<{ day: string }>(
          'select service_date::text as day from restro.payments where id = $1',
          [target.id],
        )
      ).rows
      for (const [at, amount] of rises.entries()) {
        await world.owner.query(
          `insert into restro.payment_refunds
             (id, tenant_id, venue_id, payment_id, amount_minor, seen_at, service_date, source, actor, job_id)
           values ($1, $2, $3, $4, $5, now() - make_interval(hours => $6), $7, 'restro', 'system', 'old-reading')`,
          [newId('rf'), world.tenantId, world.venueId, target.id, amount, rises.length - at, day],
        )
      }
    }
    const sum = (minors: readonly number[]) => minors.reduce((total, minor) => total + minor, 0)

    it('gives an old row the id of its refund, with no second row, alert or Log line', async () => {
      const target = await captured(null, { refundedMinor: 500 })
      await oldRows(target, [500])
      const reading = observe(target, { refunds: [made(500, 're_old')] })
      expect(await run(reading, worker())).toMatchObject({
        status: 'accepted',
        details: { changed: true, refundsAdded: 0, refundsFailed: 0 },
      })
      expect(await amounts(target.id)).toEqual([['re_old', '500', false]])
      expect(await alertsOf(target.id, 'payment_refunded')).toEqual([])
      expect(await logKinds(target.id, 'payment.refund_seen')).toEqual([])
      const before = await picture(target.id)
      expect(await run(reading, worker())).toMatchObject({ details: { changed: false } })
      expect(await picture(target.id)).toBe(before)

      // From then on it is a row like any other: when its refund fails, it is marked.
      await run(observe(target, { refunds: [failedAtProvider(500, 're_old')] }), worker())
      expect(await amounts(target.id)).toEqual([['re_old', '500', true]])
    })

    it('marks an old row whose refund has failed by the first reading by id', async () => {
      const target = await captured(null, { refundedMinor: 500 })
      await oldRows(target, [500])
      expect(
        await run(observe(target, { refunds: [failedAtProvider(500, 're_old')] }), worker()),
      ).toMatchObject({ details: { refundsFailed: 1, refundsAdded: 0 } })
      expect(await amounts(target.id)).toEqual([['re_old', '500', true]])
      expect((await stored(target.id)).refunded_minor).toBe('0')
    })

    it('counts a refund made before the rows existed as recorded, and rows only later ones', async () => {
      const target = await captured(null, { refundedMinor: 500 })
      expect(await run(observe(target, { refunds: [made(500)] }), worker())).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      expect(await refundRows(target.id)).toEqual([])
      await run(observe(target, { refunds: [made(500), made(300)] }), worker())
      expect(await amounts(target.id)).toEqual([['re_300', '300', false]])
      expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(1)
    })

    it('leaves an old row of two refunds read at once, and makes no row for either', async () => {
      const target = await captured(null, { refundedMinor: 800 })
      await oldRows(target, [800])
      const reading = observe(target, { refunds: [made(500), made(300)] })
      expect(await run(reading, worker())).toMatchObject({
        status: 'accepted',
        details: { changed: false, refundsUnmatched: 0 },
      })
      expect(await amounts(target.id)).toEqual([[null, '800', false]])
      // The later refund is seen.
      await run(observe(target, { refunds: [made(500), made(300), made(100)] }), worker())
      expect(await amounts(target.id)).toEqual([
        [null, '800', false],
        ['re_100', '100', false],
      ])
      // One of the two fails: the old row can't say which, so it stays and the worker warns.
      expect(
        await run(
          observe(target, { refunds: [failedAtProvider(500), made(300), made(100)] }),
          worker(),
        ),
      ).toMatchObject({ details: { refundsFailed: 0, refundsAdded: 0, refundsUnmatched: 1 } })
      expect((await stored(target.id)).refunded_minor).toBe('400')
    })

    // The one fact the migration is safe because of (#261): from any state the old reading can have
    // left, a reading by id counts nothing twice. The first reading adds no row, no alert and no
    // Log line, a repeat changes nothing, and a refund made later still gets its one row.
    it('never counts an old refund twice, whatever rows and totals the old reading left', async () => {
      const minor = fc.constantFrom(100, 200, 300, 500)
      await fc.assert(
        fc.asyncProperty(
          // Refunds from before the rows, then the batches each old reading made one row of.
          fc.array(minor, { maxLength: 2 }),
          fc.array(fc.array(minor, { minLength: 1, maxLength: 3 }), { maxLength: 3 }),
          fc.boolean(),
          async (beforeRows, batches, newInFirstReading) => {
            const old = [...beforeRows, ...batches.flat()]
            fc.pre(sum(old) + 150 <= 2_000)
            const target = await captured(null, { refundedMinor: sum(old) })
            await oldRows(target, batches.map(sum))
            const listed = old.map((amount, at) => made(amount, `re_old_${at}`))
            const later = made(150, 're_later')
            const rowsBefore = (await refundRows(target.id)).length

            const first = newInFirstReading ? [...listed, later] : listed
            await run(observe(target, { refunds: first }), worker())
            const rowsAfter = await refundRows(target.id)
            const added = newInFirstReading ? 1 : 0
            expect(rowsAfter).toHaveLength(rowsBefore + added)
            expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(added)
            expect(await logKinds(target.id, 'payment.refund_seen')).toHaveLength(added)
            expect((await stored(target.id)).refunded_minor).toBe(
              String(sum(first.map((r) => r.amountMinor))),
            )

            const before = await picture(target.id)
            await run(observe(target, { refunds: first }), worker())
            expect(await picture(target.id)).toBe(before)

            await run(observe(target, { refunds: [...listed, later] }), worker())
            const last = await refundRows(target.id)
            expect(last).toHaveLength(rowsBefore + 1)
            expect(last.filter((row) => row.provider_refund_ref === 're_later')).toHaveLength(1)
            expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(1)
          },
        ),
        { numRuns: 30 },
      )
    }, 120_000)
  })

  describe('"Storno done"', () => {
    const done = (refundId: string) => ({ type: 'payment.storno_done', refundId })
    const undo = (refundId: string, token: { entry: number }) => ({
      type: 'payment.storno_undo',
      refundId,
      undo: token,
    })

    it('records who and when, closes the alert, is refused a second time and is taken back by Undo', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const [refund] = await refundRows(target.id)
      const refundId = refund?.id as string

      const answer = await run(done(refundId), context(user(managerId)))
      expect(answer).toMatchObject({ status: 'accepted', details: { changed: true } })
      // Via Tonight the answer carries the token of its Log entry, for the Undo (#219).
      const token = {
        entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      expect(token.entry).toBeGreaterThan(0)
      const [after] = await refundRows(target.id)
      expect(after?.storno_at).toBeInstanceOf(Date)
      expect(after?.storno_by).toBe(`user:${managerId}`)
      expect((await alertsOf(target.id, 'payment_refunded'))[0]?.done_at).toBeInstanceOf(Date)
      expect(await logKinds(target.id, 'payment.storno')).toMatchObject([{ to_state: 'done' }])

      // A second answer is refused and the first is kept.
      expect(await run(done(refundId), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'storno_answered',
      })
      expect((await refundRows(target.id))[0]?.storno_by).toBe(`user:${managerId}`)

      // Undo within the window clears it.
      expect(await run(undo(refundId, token), context(user(managerId)))).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect((await refundRows(target.id))[0]).toMatchObject({ storno_at: null, storno_by: null })
      expect(await logKinds(target.id, 'payment.storno')).toMatchObject([
        { to_state: 'done' },
        { to_state: 'open' },
      ])
      // The alert stays closed: nobody is told again.
      expect((await alertsOf(target.id, 'payment_refunded'))[0]?.done_at).toBeInstanceOf(Date)

      // Answered again, the old token is stale: the thing changed since it was given.
      const again = await run(done(refundId), context(user(managerId)))
      expect(again).toMatchObject({ status: 'accepted' })
      expect(await run(undo(refundId, token), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'undo_stale',
      })
      expect((await refundRows(target.id))[0]?.storno_at).toBeInstanceOf(Date)
    })

    it('needs money.follow_up: a staff member without it is refused, and a refund that failed has none', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      expect(await run(done(refundId), context(user(staffUserId)))).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
      expect((await refundRows(target.id))[0]?.storno_at).toBeNull()
      expect(await run(done(newId('rf')), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_missing',
      })
      await run(observe(target, { refunds: [failedAtProvider(500)] }), worker())
      expect(await run(done(refundId), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_failed',
      })
    })

    it('takes the Undo only with the token of the very answer it takes back', async () => {
      const a = await captured()
      const b = await captured()
      await run(observe(a, { refunds: [made(500)] }), worker())
      await run(observe(b, { refunds: [made(300)] }), worker())
      const refundA = (await refundRows(a.id))[0]?.id as string
      const refundB = (await refundRows(b.id))[0]?.id as string
      const tokenOf = async (refundId: string) => {
        const answer = await run(done(refundId), context(user(managerId)))
        return {
          entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
        }
      }
      const tokenA = await tokenOf(refundA)
      const tokenB = await tokenOf(refundB)
      // A's answer cannot be taken back with B's token, nor with the Log entry of the refund itself.
      const refundSeen = (
        await world.owner.query<{ seq: string }>(
          "select seq from restro.log_entries where payment_id = $1 and kind = 'payment.refund_seen'",
          [a.id],
        )
      ).rows[0]
      for (const entry of [tokenB.entry, Number(refundSeen?.seq)]) {
        expect(await run(undo(refundA, { entry }), context(user(managerId)))).toMatchObject({
          status: 'refused',
          code: 'invalid_command',
        })
      }
      // An entry this venue does not have is expired.
      expect(
        await run(undo(refundA, { entry: 999_999_999 }), context(user(managerId))),
      ).toMatchObject({ status: 'refused', code: 'undo_expired' })
      expect((await refundRows(a.id))[0]?.storno_at).toBeInstanceOf(Date)
      expect((await refundRows(b.id))[0]?.storno_at).toBeInstanceOf(Date)
      // Its own token takes it back, and only it.
      expect(await run(undo(refundA, tokenA), context(user(managerId)))).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect((await refundRows(a.id))[0]?.storno_at).toBeNull()
      expect((await refundRows(b.id))[0]?.storno_at).toBeInstanceOf(Date)
    })

    it('has no Undo without the token it was answered with', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      await run(done(refundId), context(user(managerId)))
      expect(
        await run({ type: 'payment.storno_undo', refundId }, context(user(managerId))),
      ).toMatchObject({ status: 'refused', code: 'invalid_command' })
      expect((await refundRows(target.id))[0]?.storno_at).toBeInstanceOf(Date)
    })
  })

  describe('"Got it" on a refund that did not go through (#234)', () => {
    const seen = (refundId: string) => ({ type: 'payment.refund_failed_seen', refundId })
    const unsee = (refundId: string, token: { entry: number }) => ({
      type: 'payment.refund_failed_seen_undo',
      refundId,
      undo: token,
    })
    const failedRows = async (actor: ServiceActor, paymentId: string) => {
      const result = await readTonight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor,
      })
      if (!result.ok) throw new Error(result.code)
      return result.tonight.refunds?.failed.filter((row) => row.paymentId === paymentId) ?? []
    }
    const tabletActor = (): ServiceActor => ({
      kind: 'user',
      userId: deviceUserId,
      sessionId: deviceSession,
    })
    /** A refund whose storno was made and which then did not go through at the provider. */
    async function failedAfterStorno() {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      await run({ type: 'payment.storno_done', refundId }, context(user(managerId)))
      await run(observe(target, { refunds: [failedAtProvider(500)] }), worker())
      return { target, refundId }
    }

    it('takes the row off Tonight, writes the Log line, changes nothing a second time and comes back with Undo', async () => {
      const { target, refundId } = await failedAfterStorno()
      expect(await failedRows(user(managerId), target.id)).toHaveLength(1)
      // The tablet reads it too (a read that failed would throw), before anyone said Got it.
      expect(await failedRows(tabletActor(), target.id)).toHaveLength(1)

      const answer = await run(seen(refundId), context(user(managerId)))
      expect(answer).toMatchObject({ status: 'accepted', details: { changed: true } })
      const token = {
        entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      expect(token.entry).toBeGreaterThan(0)
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
      // The tablet, a manager's PIN there, no longer sees it either.
      expect(await failedRows(tabletActor(), target.id)).toHaveLength(0)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toMatchObject([
        { to_state: 'seen', details: { refundId } },
      ])
      // One money line in the Log, with no amount in it.
      const log = await readLog(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: user(managerId),
        search: target.ref,
      })
      if (!log.ok) throw new Error(log.code)
      expect(
        log.page.rows.filter((line) => line.kind === 'payment.refund_failed_seen'),
      ).toHaveLength(1)

      // The end of the night marks it seen, with who (the refund is of the payment's day).
      const night = await readNightPayments(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: user(managerId),
      })
      if (!night.ok) throw new Error(night.code)
      const nightRefund = night.payments.money?.refunds.find((row) => row.refundId === refundId)
      expect(nightRefund).toMatchObject({ failed: true, seen: { via: 'tonight' } })
      expect(nightRefund?.seen?.at).toBeInstanceOf(Date)

      // A second "Got it" changes nothing: no new Log entry, and no token to undo with.
      const again = await run(seen(refundId), context(user(managerId)))
      expect(again).toMatchObject({ status: 'accepted', details: { changed: false } })
      expect(
        (again as unknown as { details: Record<string, unknown> }).details.undoEntry,
      ).toBeUndefined()
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toHaveLength(1)

      // Undo brings the row back, and writes its own entry.
      expect(await run(unsee(refundId, token), context(user(managerId)))).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(1)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toMatchObject([
        { to_state: 'seen' },
        { to_state: 'open' },
      ])
      // The old token is now stale if the refund is answered again.
      await run(seen(refundId), context(user(managerId)))
      expect(await run(unsee(refundId, token), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'undo_stale',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
    })

    it('refuses a waiter, a refund that is not failed or failed before its storno, and one this venue does not have', async () => {
      const { target, refundId } = await failedAfterStorno()
      expect(await run(seen(refundId), context(user(staffUserId)))).toMatchObject({
        status: 'refused',
        code: 'permission_denied',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(1)
      expect(await run(seen(newId('rf')), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_missing',
      })
      const live = await captured()
      await run(observe(live, { refunds: [made(300)] }), worker())
      const liveId = (await refundRows(live.id))[0]?.id as string
      expect(await run(seen(liveId), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_not_failed',
      })
      // A refund that failed before its storno was made is not on Tonight's list, so no Got it.
      const early = await captured()
      await run(observe(early, { refunds: [made(400)] }), worker())
      await run(observe(early, { refunds: [failedAtProvider(400)] }), worker())
      const earlyId = (await refundRows(early.id))[0]?.id as string
      expect((await refundRows(early.id))[0]?.failed_at).toBeInstanceOf(Date)
      expect(await run(seen(earlyId), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'invalid_command',
      })
      expect(await logKinds(early.id, 'payment.refund_failed_seen')).toHaveLength(0)
    })

    // RR-59's four paths (#261).
    it('RR-59 a: of two failed refunds on one payment, "Got it" answers only the one named', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500, 're_a'), made(300, 're_b')] }), worker())
      const [a, b] = (await refundRows(target.id)).map((row) => row.id) as [string, string]
      await run({ type: 'payment.storno_done', refundId: a }, context(user(managerId)))
      await run({ type: 'payment.storno_done', refundId: b }, context(user(managerId)))
      await run(
        observe(target, {
          refunds: [failedAtProvider(500, 're_a'), failedAtProvider(300, 're_b')],
        }),
        worker(),
      )
      const onTonight = async () =>
        (await failedRows(user(managerId), target.id)).map((row) => row.refundId)
      expect((await onTonight()).toSorted()).toEqual([a, b].toSorted())

      const answer = await run(seen(a), context(user(managerId)))
      expect(answer).toMatchObject({ status: 'accepted', details: { changed: true } })
      const token = {
        entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      expect(await onTonight()).toEqual([b])
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toMatchObject([
        { to_state: 'seen', details: { refundId: a } },
      ])
      // The other refund's Undo can't use this token, and "Got it" on the first didn't answer it.
      expect(await run(unsee(b, token), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'invalid_command',
      })
      expect(await onTonight()).toEqual([b])
      // Its own Undo brings back only it.
      expect(await run(unsee(a, token), context(user(managerId)))).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect((await onTonight()).toSorted()).toEqual([a, b].toSorted())
      await run(seen(b), context(user(managerId)))
      expect(await onTonight()).toEqual([a])
    })

    it("RR-59 b: another venue's real refund and real token do nothing here", async () => {
      // A second venue of the same organisation, with a real "Got it" on a refund there.
      const venue = await provisionVenue(world.app, world.tenantId, {
        name: 'Second club',
        slug: testSlug('refunds-2'),
      })
      const area = await createArea(world.app, world.tenantId, venue.id, 'Hall')
      if (!area.ok) throw new Error('no area')
      const table = await createTable(world.app, world.tenantId, {
        areaId: area.area.id,
        name: null,
        number: '9',
      })
      if (!table.ok) throw new Error('no table')
      const day = new Date().toISOString().slice(0, 10)
      const sittingId = newId('st')
      const seed = ['restro', 'system', 'test-seed'] as const
      await world.owner.query(
        `insert into restro.sittings (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
         values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
        [sittingId, world.tenantId, venue.id, table.table.id, day, ...seed],
      )
      const paymentId = newId('py')
      await world.owner.query(
        `insert into restro.payments
           (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, handle_hash,
            amount_minor, tip_minor, captured_minor, refunded_minor, currency, provider_kind, provider_payment_ref,
            settled_at, source, actor, job_id)
         values ($1, $2, $3, $4, $5, $6, 'on_bill', 'captured', $7, 2000, 0, 2000, 0, 'EUR', 'sim-pay', $8,
                 now(), $9, $10, $11)`,
        [
          paymentId,
          world.tenantId,
          venue.id,
          table.table.id,
          sittingId,
          day,
          createHash('sha256').update(paymentId).digest('hex'),
          `simpay_${randomUUID().replaceAll('-', '')}`,
          ...seed,
        ],
      )
      const elsewhere = newId('rf')
      await world.owner.query(
        `insert into restro.payment_refunds
           (id, tenant_id, venue_id, payment_id, provider_refund_ref, amount_minor, failed_at, storno_at,
            storno_by, service_date, source, actor, job_id)
         values ($1, $2, $3, $4, 're_there', 700, now(), now(), 'user:someone', $5, $6, $7, $8)`,
        [elsewhere, world.tenantId, venue.id, paymentId, day, ...seed],
      )
      const ownerId = await world.addUser('owner')
      const there = {
        ...context(user(ownerId)),
        venueId: venue.id,
      } as ServiceContext
      const answered = await run(seen(elsewhere), there)
      expect(answered).toMatchObject({ status: 'accepted', details: { changed: true } })
      const theirToken = {
        entry: (answered as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      const theirLog = () => logKinds(paymentId, 'payment.refund_failed_seen')
      const before = JSON.stringify(await theirLog())

      // Their refund, named with this venue in the context.
      expect(await run(seen(elsewhere), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_missing',
      })
      // Their refund with their real token: this venue has no such entry.
      expect(await run(unsee(elsewhere, theirToken), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'undo_expired',
      })
      expect(JSON.stringify(await theirLog())).toBe(before)

      // Their real token on a refund of this venue.
      const { target, refundId } = await failedAfterStorno()
      await run(seen(refundId), context(user(managerId)))
      expect(await run(unsee(refundId, theirToken), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'undo_expired',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toHaveLength(1)
    })

    it('RR-59 c: the tablet needs a PIN for "Got it" and for its Undo', async () => {
      const { target, refundId } = await failedAfterStorno()
      const tablet = context(tabletActor())
      expect(await run(seen(refundId), tablet)).toMatchObject({
        status: 'refused',
        code: 'pin_required',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(1)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toHaveLength(0)

      const answer = await run(seen(refundId), context(user(managerId)))
      const token = {
        entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      expect(await run(unsee(refundId, token), tablet)).toMatchObject({
        status: 'refused',
        code: 'pin_required',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toHaveLength(1)
    })

    it('RR-59 d: a real token is refused once it is older than the 30 seconds', async () => {
      expect(STAFF_UNDO_WINDOW_MS).toBe(30_000)
      const { target, refundId } = await failedAfterStorno()
      const answer = await run(seen(refundId), context(user(managerId)))
      const token = {
        entry: (answer as unknown as { details: { undoEntry: number } }).details.undoEntry,
      }
      const age = (seconds: number) =>
        world.owner.query(
          'update restro.log_entries set at = at - make_interval(secs => $2) where seq = $1',
          [token.entry, seconds],
        )
      await age(STAFF_UNDO_WINDOW_MS / 1000 + 1)
      expect(await run(unsee(refundId, token), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'undo_expired',
      })
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
      expect(await logKinds(target.id, 'payment.refund_failed_seen')).toMatchObject([
        { to_state: 'seen' },
      ])
    })

    it('takes the Undo only with the token of the very "Got it" it takes back', async () => {
      const a = await failedAfterStorno()
      const b = await failedAfterStorno()
      const tokenOf = async (refundId: string) => ({
        entry: (
          (await run(seen(refundId), context(user(managerId)))) as unknown as {
            details: { undoEntry: number }
          }
        ).details.undoEntry,
      })
      const tokenA = await tokenOf(a.refundId)
      const tokenB = await tokenOf(b.refundId)
      expect(await run(unsee(a.refundId, tokenB), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'invalid_command',
      })
      expect(
        await run(unsee(a.refundId, { entry: 999_999_999 }), context(user(managerId))),
      ).toMatchObject({ status: 'refused', code: 'undo_expired' })
      expect(await failedRows(user(managerId), a.target.id)).toHaveLength(0)
      expect(await run(unsee(a.refundId, tokenA), context(user(managerId)))).toMatchObject({
        status: 'accepted',
        details: { changed: true },
      })
      expect(await failedRows(user(managerId), a.target.id)).toHaveLength(1)
      expect(await failedRows(user(managerId), b.target.id)).toHaveLength(0)
    })

    it('still leaves after three days when nobody said Got it, and a seen one stays gone', async () => {
      const { target, refundId } = await failedAfterStorno()
      await world.owner.query(
        "update restro.payment_refunds set failed_at = now() - interval '4 days' where id = $1",
        [refundId],
      )
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
      await world.owner.query(
        "update restro.payment_refunds set failed_at = now() - interval '2 days' where id = $1",
        [refundId],
      )
      expect(await failedRows(user(managerId), target.id)).toHaveLength(1)
      await run(seen(refundId), context(user(managerId)))
      expect(await failedRows(user(managerId), target.id)).toHaveLength(0)
    })
  })

  describe('a dispute', () => {
    it('records when it opened, its answer-by date, and when it closed, and keeps the payment six months', async () => {
      const target = await captured()
      const due = '2026-11-12T09:00:00.000Z'
      expect(
        await run(observe(target, { refunds: null, dispute: 'open', disputeDueAt: due }), worker()),
      ).toMatchObject({ status: 'accepted', details: { changed: true, dispute: 'open' } })
      const open = (
        await world.owner.query(
          `select dispute, dispute_opened_at, dispute_due_at, dispute_closed_at, retain_until
             from restro.payments where id = $1`,
          [target.id],
        )
      ).rows[0]
      expect(open).toMatchObject({ dispute: 'open', dispute_closed_at: null, retain_until: null })
      expect(open.dispute_opened_at).toBeInstanceOf(Date)
      expect(open.dispute_due_at.toISOString()).toBe(due)
      const alerts = await alertsOf(target.id, 'payment_disputed')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]?.done_at).toBeNull()
      expect(JSON.stringify(alerts[0]?.details)).not.toMatch(/amount/i)

      // The same reading again raises no second alert.
      await run(observe(target, { refunds: null, dispute: 'open', disputeDueAt: due }), worker())
      expect(await alertsOf(target.id, 'payment_disputed')).toHaveLength(1)

      await run(observe(target, { refunds: null, dispute: 'lost', disputeDueAt: due }), worker())
      const closed = (
        await world.owner.query(
          `select dispute, dispute_closed_at, retain_until, now() as now
             from restro.payments where id = $1`,
          [target.id],
        )
      ).rows[0]
      expect(closed.dispute).toBe('lost')
      expect(closed.dispute_closed_at).toBeInstanceOf(Date)
      // Close + 6 months: after 5 months 28 days and before 6 months 2 days from now.
      const months = (closed.retain_until.getTime() - closed.now.getTime()) / 86_400_000
      expect(months).toBeGreaterThan(5 * 28)
      expect(months).toBeLessThan(6 * 31 + 1)
      expect((await alertsOf(target.id, 'payment_disputed'))[0]?.done_at).toBeInstanceOf(Date)
      expect((await logKinds(target.id, 'payment.dispute')).map((l) => l.to_state)).toEqual([
        'open',
        'lost',
      ])
    })

    it('never shortens a retention that is longer', async () => {
      const target = await captured('2030-01-01T00:00:00Z')
      await run(observe(target, { refunds: null, dispute: 'open', disputeDueAt: null }), worker())
      await run(observe(target, { refunds: null, dispute: 'won', disputeDueAt: null }), worker())
      const { rows } = await world.owner.query<{ retain_until: Date }>(
        'select retain_until from restro.payments where id = $1',
        [target.id],
      )
      expect(rows[0]?.retain_until.toISOString()).toBe('2030-01-01T00:00:00.000Z')
    })
  })

  describe('Tonight', () => {
    it('shows the storno and dispute to-dos to a manager and the shared tablet, not to a waiter', async () => {
      const target = await captured()
      await run(
        observe(target, {
          refunds: [made(500)],
          dispute: 'open',
          disputeDueAt: '2026-11-12T09:00:00.000Z',
        }),
        worker(),
      )
      const read = async (actor: ServiceActor) => {
        const result = await readTonight(world.app, {
          tenantId: world.tenantId,
          venueId: world.venueId,
          actor,
        })
        if (!result.ok) throw new Error(result.code)
        return result.tonight
      }
      const manager = await read(user(managerId))
      const mine = manager.refunds?.storno.filter((row) => row.paymentId === target.id) ?? []
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({
        amountMinor: 500,
        receiptNumber: 'R-000777',
        fiscalMemoryNumber: 'FM-12345',
      })
      expect(mine[0]?.receiptAt).toBeInstanceOf(Date)
      expect(manager.refunds?.disputes.some((row) => row.paymentId === target.id)).toBe(true)

      const tablet = await read({ kind: 'user', userId: deviceUserId, sessionId: deviceSession })
      expect(tablet.refunds?.storno.some((row) => row.paymentId === target.id)).toBe(true)

      const waiter = await read(user(staffUserId))
      expect(waiter.refunds ?? null).toBeNull()

      // Answered, the row leaves; a dispute that closed leaves by itself.
      await run(
        { type: 'payment.storno_done', refundId: mine[0]?.refundId },
        context(user(managerId)),
      )
      await run(observe(target, { refunds: [made(500)], dispute: 'won' }), worker())
      const after = await read(user(managerId))
      expect(after.refunds?.storno.some((row) => row.paymentId === target.id)).toBe(false)
      expect(after.refunds?.disputes.some((row) => row.paymentId === target.id)).toBe(false)
    })
  })

  describe('what a reader who sees no tips is shown', () => {
    const readAs = async (actor: ServiceActor) => {
      const result = await readTonight(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor,
      })
      if (!result.ok) throw new Error(result.code)
      return result.tonight
    }
    const tabletActor = (): ServiceActor => ({
      kind: 'user',
      userId: deviceUserId,
      sessionId: deviceSession,
    })

    it('takes the tip off a refund of the whole payment on the tablet, and keeps the true amount apart', async () => {
      const target = await captured(null, { tipMinor: 200 })
      await run(observe(target, { refunds: [made(2_000)] }), worker())
      const tablet = await readAs(tabletActor())
      const row = tablet.refunds?.storno.find((entry) => entry.paymentId === target.id)
      // The bill is 18.00 of the 20.00 charged: the row shows no more, the PIN sheet the true 20.00.
      expect(row).toMatchObject({ amountMinor: 1_800, chargeMinor: 2_000 })
      const manager = await readAs(user(managerId))
      expect(manager.refunds?.storno.find((entry) => entry.paymentId === target.id)).toMatchObject({
        amountMinor: 2_000,
        chargeMinor: 2_000,
      })
      // A smaller refund is shown as it is.
      const part = await captured(null, { tipMinor: 200 })
      await run(observe(part, { refunds: [made(500)] }), worker())
      const again = await readAs(tabletActor())
      expect(again.refunds?.storno.find((entry) => entry.paymentId === part.id)).toMatchObject({
        amountMinor: 500,
        chargeMinor: 500,
      })
    })

    it('shows a refund that failed after its storno for three days, whatever the night', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      await run({ type: 'payment.storno_done', refundId }, context(user(managerId)))
      await run(observe(target, { refunds: [failedAtProvider(500)] }), worker())
      const failed = async () =>
        (await readAs(user(managerId))).refunds?.failed.filter((row) => row.paymentId === target.id)
      expect(await failed()).toHaveLength(1)
      await world.owner.query(
        "update restro.payment_refunds set failed_at = now() - interval '2 days' where id = $1",
        [refundId],
      )
      expect(await failed()).toHaveLength(1)
      await world.owner.query(
        "update restro.payment_refunds set failed_at = now() - interval '4 days' where id = $1",
        [refundId],
      )
      expect(await failed()).toHaveLength(0)
    })

    it('gives the dispute evidence only to a reader of the whole night who answers money', async () => {
      const target = await captured()
      const detailFor = async (userId: string) => {
        const read = await readPaymentDetail(world.app, {
          tenantId: world.tenantId,
          venueId: world.venueId,
          actor: user(userId),
          paymentId: target.id,
        })
        if (!read.ok || read.detail === null) throw new Error('no detail')
        return read.detail
      }
      expect((await detailFor(managerId)).evidence).not.toBeNull()
      const followUpOnly = await world.addUser('member')
      await world.addStaff(['log.view', 'night.view', 'money.follow_up'], followUpOnly)
      expect((await detailFor(followUpOnly)).evidence).toBeNull()
    })
  })

  describe('the Log', () => {
    const search = async (userId: string, text: string) => {
      const result = await readLog(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        actor: user(userId),
        search: text,
      })
      if (!result.ok) throw new Error(result.code)
      return result.page.rows
    }

    it('finds a payment by the provider’s payment id typed exactly, for money.follow_up only', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const found = await search(managerId, target.ref)
      expect(found.map((line) => line.kind)).toEqual(['payment.refund_seen'])
      // The line names the refund's own amount, not the payment's.
      expect(found[0]?.amountMinor).toBe(500)
      // Not a part of it, and not for a role without the right.
      expect(await search(managerId, target.ref.slice(0, 12))).toEqual([])
      const logger = await world.addUser('member')
      await world.addStaff(['log.view'], logger)
      expect(await search(logger, target.ref)).toEqual([])
    })

    it('finds the payment on any day, by the provider’s id alone', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)] }), worker())
      const onAnotherDay = (search: string) =>
        readLog(world.app, {
          tenantId: world.tenantId,
          venueId: world.venueId,
          actor: user(managerId),
          day: '2020-01-01',
          search,
        })
      const found = await onAnotherDay(target.ref)
      if (!found.ok) throw new Error(found.code)
      expect(found.page.rows.map((line) => line.kind)).toEqual(['payment.refund_seen'])
      // Any other word still looks at the day asked for only.
      const none = await onAnotherDay('K7Q')
      if (!none.ok) throw new Error(none.code)
      expect(none.page.rows).toEqual([])
    })

    it('hides the refund lines from a reader who sees no tips', async () => {
      const target = await captured()
      await run(observe(target, { refunds: [made(500)], dispute: 'open' }), worker())
      const logger = await world.addUser('member')
      await world.addStaff(['log.view'], logger)
      const kinds = (await search(logger, '')).map((line) => line.kind)
      expect(kinds).toContain('payment.dispute')
      expect(kinds).not.toContain('payment.refund_seen')
    })
  })
})
