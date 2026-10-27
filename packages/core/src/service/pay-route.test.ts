// The payment route's own rules (#111): the last check, pure; and on a real Postgres, as the
// restro_app role, who may answer an unconfirmed close. "Receipt printed" and "No receipt" are a
// manager's or an owner's (`money.follow_up`): staff without it, the worker and a second, different
// answer are refused, and the answer closes the payment's alert. The route itself runs in the
// worker's tests (apps/worker/tests/payment-route*.test.ts). Database part skipped without one.
// A property test edits the isolated bill as a waiter might (a line voided, moved back, repriced,
// its quantity changed, a round added) and checks the last check against the bill alone: it passes
// only the lines the guest confirmed, less the voided ones, and never asks for more than them.
import { createHash, randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { SERVICE_TIMINGS } from '../timings'
import { applyService, type ServiceContext } from './index'
import {
  lastCheck,
  PAYMENT_TURN_SECONDS,
  PAYMENT_WRITE_PAUSE_MS,
  paymentTurnSeconds,
} from './pay-route'
import { DEFAULT_ROLE_PERMISSIONS } from './permissions'
import { BUDGET_WAIT_MS, LEASE_MARGIN_MS } from './send-timings'

describe("the real table's write turn", () => {
  it('lasts a whole move: three reads, the pause and the write, each with its turn at the POS', () => {
    const read = BUDGET_WAIT_MS + SERVICE_TIMINGS.readTimeoutMs
    const write = BUDGET_WAIT_MS + SERVICE_TIMINGS.writeTimeoutMs
    const move = 3 * read + PAYMENT_WRITE_PAUSE_MS + write + LEASE_MARGIN_MS
    expect(PAYMENT_TURN_SECONDS * 1_000).toBeGreaterThanOrEqual(move)
    // It follows the timings.
    const slower = { ...SERVICE_TIMINGS, writeTimeoutMs: SERVICE_TIMINGS.writeTimeoutMs + 30_000 }
    expect(paymentTurnSeconds(slower)).toBe(PAYMENT_TURN_SECONDS + 30)
  })
})

describe('the last check', () => {
  const confirmed = [
    { pos: 'L1', quantity: '2.000000', amountMinor: 1_000 },
    { pos: 'L2', quantity: '1.000000', amountMinor: 450 },
  ]
  const bill = (
    lines = [
      { quantity: '2', amountMinor: 1_000 },
      { quantity: '1', amountMinor: 450 },
    ],
  ) => ({
    bills: 1,
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    paidMinor: 0,
    lines,
  })
  const check = (input: Partial<Parameters<typeof lastCheck>[0]>) =>
    lastCheck({ confirmed, isolated: bill(), real: [], partialCapture: true, ...input })

  it('passes exactly the confirmed lines and amounts, however the POS writes the quantity', () => {
    expect(check({})).toEqual({ ok: true, foundMinor: 1_450, voided: 0 })
  })

  it('fails a closed bill, a part-paid one, a total off its lines, and a line slipped in', () => {
    expect(check({ isolated: null })).toEqual({ ok: false, why: 'no_bill' })
    expect(check({ isolated: { ...bill(), bills: 2 } })).toEqual({
      ok: false,
      why: 'several_bills',
    })
    expect(check({ isolated: { ...bill(), paidMinor: 100 } })).toEqual({
      ok: false,
      why: 'part_paid',
    })
    expect(check({ isolated: { ...bill(), totalMinor: 1_300 } })).toEqual({
      ok: false,
      why: 'total_changed',
    })
    const slipped = bill([
      { quantity: '2', amountMinor: 1_000 },
      { quantity: '1', amountMinor: 450 },
      { quantity: '1', amountMinor: 450 },
    ])
    expect(check({ isolated: slipped })).toEqual({ ok: false, why: 'extra_line' })
    // The same line at another price is another line.
    const repriced = bill([
      { quantity: '2', amountMinor: 900 },
      { quantity: '1', amountMinor: 450 },
    ])
    expect(check({ isolated: repriced })).toEqual({ ok: false, why: 'extra_line' })
  })

  it('lowers the amount only for a line a fresh read of the real table shows voided', () => {
    const short = bill([{ quantity: '1', amountMinor: 450 }])
    expect(check({ isolated: short })).toEqual({ ok: true, foundMinor: 450, voided: 1 })
    // Still on the real table, or one just like it: not voided, moved back or somewhere else.
    expect(
      check({ isolated: short, real: [{ pos: 'L1', quantity: '1', amountMinor: 1 }] }),
    ).toEqual({
      ok: false,
      why: 'line_missing',
    })
    expect(
      check({ isolated: short, real: [{ pos: 'L9', quantity: '2', amountMinor: 1_000 }] }),
    ).toEqual({ ok: false, why: 'line_missing' })
    expect(check({ isolated: short, partialCapture: false })).toEqual({
      ok: false,
      why: 'partial_not_supported',
    })
  })

  it('passes, under any waiter edit, only the confirmed lines less the voided, never more', () => {
    const line = fc.record({
      quantity: fc.constantFrom('1', '2', '0.5'),
      amountMinor: fc.integer({ min: 1, max: 3_000 }),
    })
    /** What a waiter did to a confirmed line before the last check. */
    const fate = fc.constantFrom('kept', 'voided', 'moved_back', 'repriced', 'requantified')
    type Line = { readonly quantity: string; readonly amountMinor: number }
    const key = (l: Line) => `${Number(l.quantity)}:${l.amountMinor}`
    const counts = (lines: readonly Line[]) => {
      const found = new Map<string, number>()
      for (const l of lines) found.set(key(l), (found.get(key(l)) ?? 0) + 1)
      return found
    }
    const sum = (lines: readonly Line[]) => lines.reduce((total, l) => total + l.amountMinor, 0)
    fc.assert(
      fc.property(
        fc.array(fc.tuple(line, fate), { minLength: 1, maxLength: 4 }),
        fc.array(line, { maxLength: 2 }),
        fc.boolean(),
        (picked, added, partialCapture) => {
          const confirmed = picked.map(([l], index) => ({ pos: `L${index}`, ...l }))
          const lines: Line[] = [
            ...picked.flatMap(([l, f]): Line[] => {
              // A kept line in the POS's own writing of its quantity.
              if (f === 'kept') return [{ ...l, quantity: Number(l.quantity).toFixed(6) }]
              if (f === 'repriced') return [{ ...l, amountMinor: l.amountMinor + 1 }]
              if (f === 'requantified') return [{ ...l, quantity: l.quantity === '1' ? '2' : '1' }]
              return []
            }),
            ...added,
          ]
          const real = picked.flatMap(([l, f], index) =>
            f === 'moved_back' ? [{ pos: `L${index}`, ...l }] : [],
          )
          const result = lastCheck({
            confirmed,
            isolated: { bills: 1, totalMinor: sum(lines), paidMinor: 0, lines },
            real,
            partialCapture,
          })
          // The outcome from the bill alone: no line the guest did not confirm, and every missing
          // one gone from the real table too (voided), where the provider captures less.
          const want = counts(confirmed)
          const have = counts(lines)
          const extra = [...have].some(([k, n]) => n > (want.get(k) ?? 0))
          const missing = [...want].filter(([k, n]) => n > (have.get(k) ?? 0))
          const voided = missing.reduce((total, [k, n]) => total + n - (have.get(k) ?? 0), 0)
          const realKeys = new Set(real.map(key))
          if (lines.length === 0) expect(result).toEqual({ ok: false, why: 'no_bill' })
          else if (extra) expect(result).toEqual({ ok: false, why: 'extra_line' })
          else if (voided === 0)
            expect(result).toEqual({ ok: true, foundMinor: sum(lines), voided })
          else if (missing.some(([k]) => realKeys.has(k))) {
            expect(result).toEqual({ ok: false, why: 'line_missing' })
          } else if (!partialCapture) {
            expect(result).toEqual({ ok: false, why: 'partial_not_supported' })
          } else expect(result).toEqual({ ok: true, foundMinor: sum(lines), voided })
          // Never more than the guest confirmed.
          if (result.ok) expect(result.foundMinor).toBeLessThanOrEqual(sum(confirmed))
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe.skipIf(!hasDatabase)('answering an unconfirmed close (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let managerId: string
  let staffId: string
  let sittingId: string

  beforeAll(async () => {
    world = await openServiceWorld('pay-route')
    ownerId = await world.addUser('owner')
    managerId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.manager, managerId)
    staffId = await world.addUser('member')
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, staffId)
    sittingId = await world.openSitting(world.tables[0] as string)
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: 'session-1' },
    jobId: `pay-route-${randomUUID()}`,
    via: 'tonight',
  })
  const worker = (): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'worker',
    actor: { kind: 'system' },
    jobId: `pay-route-worker-${randomUUID()}`,
  })

  /** A card payment whose close the POS didn't confirm, with its open staff alert. */
  async function unconfirmed(): Promise<{ id: string; alertId: string }> {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, currency, provider_kind, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, current_date, 'on_bill', 'unconfirmed', 'close_unknown',
          $6, 1450, 'EUR', 'sim-pay', now(), 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        world.tables[0],
        sittingId,
        createHash('sha256').update(id).digest('hex'),
      ],
    )
    const alertId = newId('al')
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, current_date, 'payment_unconfirmed', 'venue', $4, 'money.follow_up',
          '{}'::jsonb, 'restro', 'system', 'test-seed')`,
      [alertId, world.tenantId, world.venueId, id],
    )
    return { id, alertId }
  }

  const answer = (context: ServiceContext, paymentId: string, value: string) =>
    applyService(world.app, { type: 'payment.answer', paymentId, answer: value }, context)

  const stored = async (id: string, alertId: string) => ({
    payment: (
      await world.owner.query<{ state: string; reason: string | null }>(
        'select state, reason from restro.payments where id = $1',
        [id],
      )
    ).rows[0],
    alertDone:
      (
        await world.owner.query<{ done_at: Date | null }>(
          'select done_at from restro.alerts where id = $1',
          [alertId],
        )
      ).rows[0]?.done_at !== null,
  })

  it('refuses staff without money.follow_up, and the worker', async () => {
    const { id, alertId } = await unconfirmed()
    expect((await answer(user(staffId), id, 'receipt_printed')).result).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    expect((await answer(worker(), id, 'receipt_printed')).result).toMatchObject({
      status: 'refused',
      code: 'origin_not_allowed',
    })
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'close_unknown' },
      alertDone: false,
    })
  })

  it('takes a manager’s "Receipt printed", closes the alert and logs the answer', async () => {
    const { id, alertId } = await unconfirmed()
    const { result } = await answer(user(managerId), id, 'receipt_printed')
    expect(result).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'receipt_printed' },
      alertDone: true,
    })
    const log = await world.owner.query<{ from_state: string; to_state: string }>(
      `select from_state, to_state from restro.log_entries
        where kind = 'payment.answered' and payment_id = $1`,
      [id],
    )
    expect(log.rows).toEqual([{ from_state: 'close_unknown', to_state: 'receipt_printed' }])
    // The same answer again changes nothing; a different one is refused.
    expect((await answer(user(ownerId), id, 'receipt_printed')).result).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect((await answer(user(ownerId), id, 'no_receipt')).result).toMatchObject({
      status: 'refused',
      code: 'payment_answered',
    })
  })

  it('takes an owner’s "No receipt"', async () => {
    const { id, alertId } = await unconfirmed()
    const { result } = await answer(user(ownerId), id, 'no_receipt')
    expect(result.status).toBe('accepted')
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'no_receipt' },
      alertDone: true,
    })
  })

  it('refuses an answer to a payment that is not unconfirmed', async () => {
    const { id } = await unconfirmed()
    await world.owner.query(
      `update restro.payments set state = 'captured', captured_minor = 1450 where id = $1`,
      [id],
    )
    expect((await answer(user(ownerId), id, 'no_receipt')).result).toMatchObject({
      status: 'refused',
      code: 'payment_not_unconfirmed',
    })
  })
})
