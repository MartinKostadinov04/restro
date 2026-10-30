// Refunds and disputes read back from the provider (#222; D122 §8, decision log 5.1–5.11) on a real
// Postgres as the restro_app role: each rise of the refund total is one refund row with one Log
// entry and one amount-free alert for the group; a repeat raises nothing; two partial refunds make
// two rows; a falling total marks the newest row "didn't go through"; "Storno done" records who
// and when, is refused a second time, and is taken back by its Undo; a dispute records when it
// opened and when it closed, the answer-by date and the retention; Tonight reads the to-dos for
// managers and the shared tablet and not for a waiter. Skipped without a database.
import { createHash, randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, readLog, readPaymentDetail, readTonight, type ServiceCommand } from './index'
import { disputeRetainUntil } from './payment-observe'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'

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
  const observe = (
    target: { id: string; ref: string },
    reading: {
      refundedMinor: number
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
        amount_minor: string
        failed_at: Date | null
        storno_at: Date | null
        storno_by: string | null
        service_date: string
      }>(
        `select id, amount_minor, failed_at, storno_at, storno_by, service_date::text
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
    const first = await run(observe(target, { refundedMinor: 500 }), worker())
    expect(first).toMatchObject({ status: 'accepted', details: { changed: true, refundsAdded: 1 } })
    const rows = await refundRows(target.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount_minor: '500', failed_at: null, storno_at: null })

    const alerts = await alertsOf(target.id, 'payment_refunded')
    expect(alerts).toHaveLength(1)
    // The group is told the table and the day, never an amount (decision log 5.8).
    expect(JSON.stringify(alerts[0]?.details)).not.toMatch(/500|amount/i)
    expect(alerts[0]?.details).toMatchObject({ refundId: rows[0]?.id, providerKind: 'sim-pay' })
    expect(await logKinds(target.id, 'payment.refund_seen')).toMatchObject([
      { to_state: 'seen', details: { amountMinor: 500, refundId: rows[0]?.id } },
    ])

    // The same reading again (a notice that comes twice) raises nothing new.
    expect(await run(observe(target, { refundedMinor: 500 }), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await refundRows(target.id)).toHaveLength(1)
    expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(1)
  })

  it('makes two rows for two partial refunds, and one row for two read back at once', async () => {
    const target = await captured()
    await run(observe(target, { refundedMinor: 500 }), worker())
    await run(observe(target, { refundedMinor: 1_200 }), worker())
    expect((await refundRows(target.id)).map((r) => r.amount_minor)).toEqual(['500', '700'])
    expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(2)

    // Two refunds that happened before the worker looked read as one rise.
    const batch = await captured()
    await run(observe(batch, { refundedMinor: 1_500 }), worker())
    expect((await refundRows(batch.id)).map((r) => r.amount_minor)).toEqual(['1500'])
  })

  it('marks only the row whose amount the total fell by, and never invents one', async () => {
    const target = await captured()
    await run(observe(target, { refundedMinor: 500 }), worker())
    await run(observe(target, { refundedMinor: 800 }), worker())
    // The first refund fails: 800 falls to 300, by exactly the first row's 500.
    expect(await run(observe(target, { refundedMinor: 300 }), worker())).toMatchObject({
      status: 'accepted',
      details: { refundsFailed: 1, refundsAdded: 0, refundsUnmatched: 0 },
    })
    const rows = await refundRows(target.id)
    expect(rows.map((r) => [r.amount_minor, r.failed_at !== null])).toEqual([
      ['500', true],
      ['300', false],
    ])
    const alerts = await alertsOf(target.id, 'payment_refunded')
    expect(alerts.map((a) => a.done_at !== null)).toEqual([true, false])
    expect(await logKinds(target.id, 'payment.refund_seen')).toMatchObject([
      { to_state: 'seen' },
      { to_state: 'seen' },
      { to_state: 'failed', details: { amountMinor: 500 } },
    ])
    // It rises again by the same amount: a new row, not the failed one back.
    await run(observe(target, { refundedMinor: 800 }), worker())
    expect((await refundRows(target.id)).map((r) => r.amount_minor)).toEqual(['500', '300', '500'])
  })

  it('pins the known limit: a failed refund and a new one read together do not mark the failed one', async () => {
    const target = await captured()
    await run(observe(target, { refundedMinor: 500 }), worker())
    // The 500 failed and 800 was refunded before the next reading: 500 → 800 reads as a rise of 300.
    await run(observe(target, { refundedMinor: 800 }), worker())
    expect(
      (await refundRows(target.id)).map((r) => [r.amount_minor, r.failed_at !== null]),
    ).toEqual([
      ['500', false],
      ['300', false],
    ])
  })

  // Hot spot 10 (RR-1): each row is a storno to-do, so what is still to storno must be what the
  // provider says was refunded, after every reading, whatever happened between two readings: the
  // venue's refunds made and failed, in any batch. Today's rows follow one total, not refunds.
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
          const refunds: number[] = []
          const total = () => refunds.reduce((sum, minor) => sum + minor, 0)
          for (const reading of readings) {
            for (const event of reading) {
              if (event.kind === 'made' && total() + event.minor <= 2_000) refunds.push(event.minor)
              if (event.kind === 'failed' && refunds.length > 0) {
                refunds.splice(event.which % refunds.length, 1)
              }
            }
            await run(observe(target, { refundedMinor: total() }), worker())
            const active = (await refundRows(target.id)).filter((row) => row.failed_at === null)
            expect(active.reduce((sum, row) => sum + Number(row.amount_minor), 0)).toBe(total())
          }
        },
      ),
      { numRuns: 40 },
    )
  }, 120_000)

  it('marks nothing and makes no row when the total falls by an amount no row has', async () => {
    const target = await captured()
    await run(observe(target, { refundedMinor: 500 }), worker())
    await run(observe(target, { refundedMinor: 800 }), worker())
    const answer = await run(observe(target, { refundedMinor: 600 }), worker())
    expect(answer).toMatchObject({
      status: 'accepted',
      details: { changed: true, refundsFailed: 0, refundsAdded: 0, refundsUnmatched: 1 },
    })
    const rows = await refundRows(target.id)
    expect(rows.map((r) => [r.amount_minor, r.failed_at])).toEqual([
      ['500', null],
      ['300', null],
    ])
    // The stored total follows the provider's, and a rise from it makes one row for the rise.
    expect((await stored(target.id)).refunded_minor).toBe('600')
    await run(observe(target, { refundedMinor: 700 }), worker())
    expect((await refundRows(target.id)).map((r) => r.amount_minor)).toEqual(['500', '300', '100'])
  })

  it('counts a refund made before the rows existed as recorded, and rows only later rises', async () => {
    const target = await captured(null, { refundedMinor: 500 })
    expect(await run(observe(target, { refundedMinor: 500 }), worker())).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect(await refundRows(target.id)).toEqual([])
    await run(observe(target, { refundedMinor: 800 }), worker())
    expect((await refundRows(target.id)).map((r) => r.amount_minor)).toEqual(['300'])
    expect(await alertsOf(target.id, 'payment_refunded')).toHaveLength(1)
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
      await run(observe(target, { refundedMinor: 500 }), worker())
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
      await run(observe(target, { refundedMinor: 500 }), worker())
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
      await run(observe(target, { refundedMinor: 0 }), worker())
      expect(await run(done(refundId), context(user(managerId)))).toMatchObject({
        status: 'refused',
        code: 'refund_failed',
      })
    })

    it('takes the Undo only with the token of the very answer it takes back', async () => {
      const a = await captured()
      const b = await captured()
      await run(observe(a, { refundedMinor: 500 }), worker())
      await run(observe(b, { refundedMinor: 300 }), worker())
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
      await run(observe(target, { refundedMinor: 500 }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      await run(done(refundId), context(user(managerId)))
      expect(
        await run({ type: 'payment.storno_undo', refundId }, context(user(managerId))),
      ).toMatchObject({ status: 'refused', code: 'invalid_command' })
      expect((await refundRows(target.id))[0]?.storno_at).toBeInstanceOf(Date)
    })
  })

  describe('a dispute', () => {
    it('records when it opened, its answer-by date, and when it closed, and keeps the payment six months', async () => {
      const target = await captured()
      const due = '2026-11-12T09:00:00.000Z'
      expect(
        await run(
          observe(target, { refundedMinor: 0, dispute: 'open', disputeDueAt: due }),
          worker(),
        ),
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
      await run(observe(target, { refundedMinor: 0, dispute: 'open', disputeDueAt: due }), worker())
      expect(await alertsOf(target.id, 'payment_disputed')).toHaveLength(1)

      await run(observe(target, { refundedMinor: 0, dispute: 'lost', disputeDueAt: due }), worker())
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
      await run(
        observe(target, { refundedMinor: 0, dispute: 'open', disputeDueAt: null }),
        worker(),
      )
      await run(observe(target, { refundedMinor: 0, dispute: 'won', disputeDueAt: null }), worker())
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
          refundedMinor: 500,
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
      await run(observe(target, { refundedMinor: 500, dispute: 'won' }), worker())
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
      await run(observe(target, { refundedMinor: 2_000 }), worker())
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
      await run(observe(part, { refundedMinor: 500 }), worker())
      const again = await readAs(tabletActor())
      expect(again.refunds?.storno.find((entry) => entry.paymentId === part.id)).toMatchObject({
        amountMinor: 500,
        chargeMinor: 500,
      })
    })

    it('shows a refund that failed after its storno for three days, whatever the night', async () => {
      const target = await captured()
      await run(observe(target, { refundedMinor: 500 }), worker())
      const refundId = (await refundRows(target.id))[0]?.id as string
      await run({ type: 'payment.storno_done', refundId }, context(user(managerId)))
      await run(observe(target, { refundedMinor: 0 }), worker())
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
      await run(observe(target, { refundedMinor: 500 }), worker())
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
      await run(observe(target, { refundedMinor: 500 }), worker())
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
      await run(observe(target, { refundedMinor: 500, dispute: 'open' }), worker())
      const logger = await world.addUser('member')
      await world.addStaff(['log.view'], logger)
      const kinds = (await search(logger, '')).map((line) => line.kind)
      expect(kinds).toContain('payment.dispute')
      expect(kinds).not.toContain('payment.refund_seen')
    })
  })
})
