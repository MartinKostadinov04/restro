// The payment route's own rules (#111): the last check, pure; and on a real Postgres, as the
// restro_app role, who may answer an unconfirmed close. "Receipt printed" and "No receipt" are a
// manager's or an owner's (`money.follow_up`): staff without it, the worker and a second, different
// answer are refused, and the answer closes the payment's alert. Asked again when the items were
// not back after "No receipt" (#153), a second "No receipt" settles it stranded for staff; a move
// back's step carries the lines it moves, and only that step. The route itself runs in the worker's
// tests (apps/worker/tests/payment-route*.test.ts). Database part skipped without one.
// A property test edits the isolated bill as a waiter might (a line voided, moved back, repriced,
// its quantity changed, a round added) and checks the last check against the bill alone: it passes
// only the lines the guest confirmed, less the voided ones, and never asks for more than them. A
// second one (#112, F10) states each night's outcome from what the waiter did, not from the check's
// own counting: a line back on the real table at another price, another bill on the payment table,
// a part payment and a total off its lines among them.
// The recovery's commands (#112): an expired hold settles `released`, reason `expired`, closing
// both questions; a stuck payment tells Restro's team once; the provider's breaker pauses paying in
// the app and lifts it, with its alert, and never touches ordering.
import { createHash, randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../apply/test-database'
import { newId } from '../ids'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import { SERVICE_TIMINGS } from '../timings'
import { PAYING_PAUSED_KIND, PAYMENT_STUCK_KIND } from './alert-rules'
import { closedBreaker } from './breaker'
import { applyService, PaymentStepLinesSchema, type ServiceContext } from './index'
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
    expect(check({})).toEqual({ ok: true, foundMinor: 1_450, voided: 0, found: [0, 1] })
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
    // The voided line (the first) is not among those the POS closes.
    expect(check({ isolated: short })).toEqual({ ok: true, foundMinor: 450, voided: 1, found: [1] })
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
          // The confirmed lines the bill holds, in order: those the POS closes.
          const left = counts(lines)
          const found = confirmed.flatMap((l, index) => {
            const open = left.get(key(l)) ?? 0
            if (open === 0) return []
            left.set(key(l), open - 1)
            return [index]
          })
          if (lines.length === 0) expect(result).toEqual({ ok: false, why: 'no_bill' })
          else if (extra) expect(result).toEqual({ ok: false, why: 'extra_line' })
          else if (voided === 0)
            expect(result).toEqual({ ok: true, foundMinor: sum(lines), voided, found })
          else if (missing.some(([k]) => realKeys.has(k))) {
            expect(result).toEqual({ ok: false, why: 'line_missing' })
          } else if (!partialCapture) {
            expect(result).toEqual({ ok: false, why: 'partial_not_supported' })
          } else expect(result).toEqual({ ok: true, foundMinor: sum(lines), voided, found })
          // Never more than the guest confirmed.
          if (result.ok) expect(result.foundMinor).toBeLessThanOrEqual(sum(confirmed))
        },
      ),
      { numRuns: 500 },
    )
  })

  it('gives each night the outcome of what the waiter did, bill by bill (F10)', () => {
    /**
     * What a waiter did to a confirmed line: kept it, voided it, moved it back to the real table
     * (as it was, or at another price), put a twin of it on the real table and voided it, repriced
     * it or changed its quantity on the payment table.
     */
    const fate = fc.constantFrom(
      'kept',
      'voided',
      'moved_back',
      'moved_back_repriced',
      'twin_on_real',
      'repriced',
      'requantified',
    )
    /** What happened to the payment table's bill as a whole. */
    const whole = fc.constantFrom('none', 'second_bill', 'part_paid', 'total_off')
    type Line = { readonly quantity: string; readonly amountMinor: number }
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('1', '2', '0.5'), fc.nat({ max: 99 }), fate), {
          minLength: 1,
          maxLength: 4,
        }),
        fc.nat({ max: 2 }),
        whole,
        fc.boolean(),
        (picked, added, bill, partialCapture) => {
          // Each confirmed line's amount is its own (a multiple of 10, unique by position): a
          // repriced one ends in 1, an added round in 5, nothing on the real table's noise in 7.
          const confirmed = picked.map(([quantity, cents], index) => ({
            pos: `L${index}`,
            quantity,
            amountMinor: (index + 1) * 1_000 + cents * 10,
          }))
          const fates = picked.map(([, , f]) => f)
          const lines: Line[] = [
            ...confirmed.flatMap((l, index): Line[] => {
              const f = fates[index]
              if (f === 'kept')
                return [{ quantity: Number(l.quantity).toFixed(6), amountMinor: l.amountMinor }]
              if (f === 'repriced')
                return [{ quantity: l.quantity, amountMinor: l.amountMinor + 1 }]
              if (f === 'requantified') {
                return [{ quantity: l.quantity === '1' ? '2' : '1', amountMinor: l.amountMinor }]
              }
              return []
            }),
            ...Array.from({ length: added }, (_, n) => ({
              quantity: '1',
              amountMinor: 105 + n * 10,
            })),
          ]
          const real = [
            { pos: 'R9', quantity: '1', amountMinor: 77 },
            ...confirmed.flatMap((l, index) => {
              const f = fates[index]
              if (f === 'moved_back') return [l]
              if (f === 'moved_back_repriced') return [{ ...l, amountMinor: l.amountMinor + 3 }]
              if (f === 'twin_on_real') return [{ ...l, pos: `T${index}` }]
              return []
            }),
          ]
          const linesMinor = lines.reduce((total, l) => total + l.amountMinor, 0)
          const result = lastCheck({
            confirmed,
            isolated: {
              bills: bill === 'second_bill' ? 2 : 1,
              totalMinor: linesMinor + (bill === 'total_off' ? 50 : 0),
              paidMinor: bill === 'part_paid' ? 100 : 0,
              lines,
            },
            real,
            partialCapture,
          })
          const keptMinor = confirmed
            .filter((_, index) => fates[index] === 'kept')
            .reduce((total, l) => total + l.amountMinor, 0)
          const missing = fates.filter((f) => f !== 'kept').length
          const onReal = fates.some(
            (f) => f === 'moved_back' || f === 'moved_back_repriced' || f === 'twin_on_real',
          )
          const changed = fates.some((f) => f === 'repriced' || f === 'requantified')
          // The lines the POS closes are the kept ones, by their place among the confirmed.
          const found = confirmed.flatMap((_, index) => (fates[index] === 'kept' ? [index] : []))
          let want: ReturnType<typeof lastCheck>
          if (lines.length === 0) want = { ok: false, why: 'no_bill' }
          else if (bill === 'second_bill') want = { ok: false, why: 'several_bills' }
          else if (bill === 'part_paid') want = { ok: false, why: 'part_paid' }
          else if (bill === 'total_off') want = { ok: false, why: 'total_changed' }
          else if (changed || added > 0) want = { ok: false, why: 'extra_line' }
          else if (missing === 0) want = { ok: true, foundMinor: keptMinor, voided: 0, found }
          else if (onReal) want = { ok: false, why: 'line_missing' }
          else if (!partialCapture) want = { ok: false, why: 'partial_not_supported' }
          else want = { ok: true, foundMinor: keptMinor, voided: missing, found }
          expect(result).toEqual(want)
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

  /**
   * A card payment whose close the POS didn't confirm, with its open staff alert; or one whose
   * items were not back after "No receipt" (`lines_not_back`, #153), its close attempted.
   */
  async function unconfirmed(
    reason: 'close_unknown' | 'lines_not_back' = 'close_unknown',
  ): Promise<{ id: string; alertId: string }> {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, currency, provider_kind, settled_at, source, actor, job_id)
       values ($1, $2, $3, $4, $5, current_date, 'on_bill', 'unconfirmed', $7,
          $6, 1450, 'EUR', 'sim-pay', now(), 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        world.tables[0],
        sittingId,
        createHash('sha256').update(id).digest('hex'),
        reason,
      ],
    )
    await world.owner.query(
      `insert into restro.payment_steps
         (tenant_id, venue_id, payment_id, step, outcome, answer, source, actor, job_id)
       values ($1, $2, $3, 'payAndClose', 'attempting', null, 'worker', 'system', 'test-seed')`,
      [world.tenantId, world.venueId, id],
    )
    const alertId = newId('al')
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, current_date, $5, 'venue', $4, 'money.follow_up',
          '{}'::jsonb, 'restro', 'system', 'test-seed')`,
      [
        alertId,
        world.tenantId,
        world.venueId,
        id,
        reason === 'close_unknown' ? 'payment_unconfirmed' : 'payment_lines_not_back',
      ],
    )
    return { id, alertId }
  }

  const answer = (
    context: ServiceContext,
    paymentId: string,
    value: string,
    answering: 'close' | 'lines_not_back' = 'close',
  ) =>
    applyService(
      world.app,
      { type: 'payment.answer', paymentId, answering, answer: value },
      context,
    )

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

  it('takes "Receipt printed" when the items were not back after "No receipt"', async () => {
    const { id, alertId } = await unconfirmed('lines_not_back')
    const { result } = await answer(user(managerId), id, 'receipt_printed', 'lines_not_back')
    expect(result).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'receipt_printed' },
      alertDone: true,
    })
    expect((await answer(user(ownerId), id, 'no_receipt', 'lines_not_back')).result).toMatchObject({
      status: 'refused',
      code: 'payment_answered',
    })
  })

  it('takes a second "No receipt": released and stranded, no move back; another tap refused', async () => {
    const { id, alertId } = await unconfirmed('lines_not_back')
    const { result } = await answer(user(managerId), id, 'no_receipt', 'lines_not_back')
    expect(result).toMatchObject({
      status: 'accepted',
      details: { changed: true, state: 'cancelling' },
    })
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'cancelling', reason: 'stranded' },
      alertDone: true,
    })
    const raised = await world.owner.query<{ kind: string; permission: string }>(
      `select kind, permission from restro.alerts where subject_id = $1 and done_at is null`,
      [id],
    )
    expect(raised.rows).toEqual([{ kind: 'payment_stranded', permission: 'alerts.answer' }])
    const log = await world.owner.query<{ from_state: string; to_state: string }>(
      `select from_state, to_state, details->>'answering' as answering from restro.log_entries
        where kind = 'payment.answered' and payment_id = $1`,
      [id],
    )
    expect(log.rows).toEqual([
      { from_state: 'lines_not_back', to_state: 'no_receipt', answering: 'lines_not_back' },
    ])
    for (const answering of ['lines_not_back', 'close'] as const) {
      expect((await answer(user(ownerId), id, 'no_receipt', answering)).result).toMatchObject({
        status: 'accepted',
        details: { changed: false },
      })
      expect((await answer(user(ownerId), id, 'receipt_printed', answering)).result).toMatchObject({
        status: 'refused',
        code: 'payment_answered',
      })
    }
  })

  it('never takes a late answer to the close for the second question, nor the second unasked', async () => {
    // A second manager, a retry or an old push answering the close once the second is asked.
    const { id, alertId } = await unconfirmed('lines_not_back')
    expect((await answer(user(ownerId), id, 'no_receipt')).result).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect((await answer(user(ownerId), id, 'receipt_printed')).result).toMatchObject({
      status: 'refused',
      code: 'payment_answered',
    })
    expect(await stored(id, alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'lines_not_back' },
      alertDone: false,
    })
    // The second question before it is asked.
    const first = await unconfirmed()
    for (const value of ['no_receipt', 'receipt_printed']) {
      expect((await answer(user(ownerId), first.id, value, 'lines_not_back')).result).toMatchObject(
        { status: 'refused', code: 'payment_not_asked' },
      )
    }
    expect(await stored(first.id, first.alertId)).toEqual({
      payment: { state: 'unconfirmed', reason: 'close_unknown' },
      alertDone: false,
    })
  })

  it('records a move back’s lines on its attempting step only, and reads them back typed', async () => {
    const { id } = await unconfirmed()
    const lines = [
      { pos: '9100003', quantity: '2', amountMinor: 2200 },
      { pos: '9100004', quantity: '0.5', amountMinor: -300 },
    ]
    const step = (fields: Record<string, unknown>) =>
      applyService(
        world.app,
        {
          type: 'payment.step',
          paymentId: id,
          step: 'undoIsolate',
          outcome: 'attempting',
          answer: null,
          idempotencyKey: `${id}-undo`,
          ...fields,
        },
        worker(),
      )
    expect((await step({ lines })).result).toMatchObject({ status: 'accepted' })
    // Only a move back, before its call: anywhere else they are refused and nothing is written.
    for (const fields of [
      { outcome: 'done', lines },
      { step: 'payAndClose', idempotencyKey: `${id}-close`, lines },
      { lines: [] },
    ]) {
      expect((await step(fields)).result).toMatchObject({
        status: 'refused',
        code: 'invalid_command',
      })
    }
    expect((await step({ outcome: 'done', answer: null })).result).toMatchObject({
      status: 'accepted',
    })
    const rows = (
      await world.owner.query<{ step: string; outcome: string; lines: unknown }>(
        `select step, outcome, lines from restro.payment_steps
          where payment_id = $1 and step = 'undoIsolate' order by seq`,
        [id],
      )
    ).rows
    expect(rows.map((row) => [row.outcome, row.lines === null])).toEqual([
      ['attempting', false],
      ['done', true],
    ])
    expect(PaymentStepLinesSchema.parse(rows[0]?.lines)).toEqual(lines)
  })

  /** A payment in `state` with no lines, unsettled unless `settled`. */
  async function payment(state: string, reason: string | null = null): Promise<string> {
    const id = newId('py')
    await world.owner.query(
      `insert into restro.payments
         (id, tenant_id, venue_id, table_id, sitting_id, service_date, kind, state, reason,
          handle_hash, amount_minor, currency, provider_kind, source, actor, job_id)
       values ($1, $2, $3, $4, $5, current_date, 'on_bill', $6, $7,
          $8, 1450, 'EUR', 'sim-pay', 'restro', 'system', 'test-seed')`,
      [
        id,
        world.tenantId,
        world.venueId,
        world.tables[0],
        sittingId,
        state,
        reason,
        createHash('sha256').update(id).digest('hex'),
      ],
    )
    return id
  }
  const expired = (id: string) =>
    applyService(
      world.app,
      { type: 'payment.expired', paymentId: id, status: 'released' },
      worker(),
    )
  const openAlerts = async (id: string) =>
    (
      await world.owner.query<{ kind: string }>(
        `select kind from restro.alerts where subject_id = $1 and done_at is null order by kind`,
        [id],
      )
    ).rows.map((row) => row.kind)

  it('settles an expired hold released, reason expired, closing both questions, and logs it', async () => {
    const { id } = await unconfirmed('lines_not_back')
    // The close's question was left open beside the second one.
    await world.owner.query(
      `insert into restro.alerts
         (id, tenant_id, venue_id, service_date, kind, audience, subject_id, permission, details,
          source, actor, job_id)
       values ($1, $2, $3, current_date, 'payment_unconfirmed', 'venue', $4, 'money.follow_up',
          '{}'::jsonb, 'restro', 'system', 'test-seed')`,
      [newId('al'), world.tenantId, world.venueId, id],
    )
    expect(await openAlerts(id)).toEqual(['payment_lines_not_back', 'payment_unconfirmed'])
    expect((await expired(id)).result).toMatchObject({
      status: 'accepted',
      details: { changed: true, state: 'released' },
    })
    const row = (
      await world.owner.query<{ state: string; reason: string; kept: boolean }>(
        `select state, reason, retain_until > now() + interval '17 months' as kept
           from restro.payments where id = $1`,
        [id],
      )
    ).rows[0]
    expect(row).toEqual({ state: 'released', reason: 'expired', kept: true })
    // Both questions closed; the owners and the team are told the hold ran out unanswered.
    expect(await openAlerts(id)).toEqual(['payment_hold_expired'])
    const told = (
      await world.owner.query<{ permission: string; audience: string }>(
        `select permission, audience from restro.alerts
          where subject_id = $1 and kind = 'payment_hold_expired'`,
        [id],
      )
    ).rows
    expect(told).toEqual([{ permission: 'money.follow_up', audience: 'venue' }])
    const log = await world.owner.query<{ to_state: string; reason: string; closed: string }>(
      `select to_state, reason, details->>'questionClosed' as closed from restro.log_entries
        where kind = 'payment.state' and payment_id = $1`,
      [id],
    )
    expect(log.rows).toEqual([
      {
        to_state: 'released',
        reason: 'expired',
        closed: 'payment_unconfirmed,payment_lines_not_back',
      },
    ])
    // Again: nothing changes.
    expect((await expired(id)).result).toMatchObject({ details: { changed: false } })
  })

  it('leaves an answered payment and one whose lines moved to the route', async () => {
    const { id } = await unconfirmed()
    await answer(user(managerId), id, 'receipt_printed')
    expect((await expired(id)).result).toMatchObject({
      status: 'accepted',
      details: { changed: false, state: 'unconfirmed' },
    })
    const moved = await payment('isolated')
    expect((await expired(moved)).result).toMatchObject({ details: { changed: false } })
    // Waiting for a payment table, nothing moved yet: released.
    const waiting = await payment('queued')
    expect((await expired(waiting)).result).toMatchObject({
      details: { changed: true, state: 'released' },
    })
  })

  it("tells Restro's team once about a payment stuck in the worker's own states", async () => {
    const stuck = (id: string) =>
      applyService(world.app, { type: 'payment.stuck', paymentId: id }, worker())
    const id = await payment('priced')
    expect((await stuck(id)).result).toMatchObject({
      status: 'accepted',
      details: { changed: true, state: 'priced' },
    })
    expect((await stuck(id)).result).toMatchObject({ details: { changed: false } })
    const raised = await world.owner.query<{ audience: string; permission: string | null }>(
      `select audience, permission from restro.alerts where subject_id = $1 and kind = $2`,
      [id, PAYMENT_STUCK_KIND],
    )
    expect(raised.rows).toEqual([{ audience: 'restro', permission: null }])
    // A payment waiting for the guest or a table is not the worker's to move on.
    for (const state of ['awaiting_guest', 'held']) {
      expect((await stuck(await payment(state))).result).toMatchObject({
        details: { changed: false },
      })
    }
  })

  it('pauses paying in the app at the venue and lifts it, with its alert; ordering is not paused', async () => {
    const breaker = (action: 'pause' | 'progress' | 'lift') =>
      applyService(
        world.app,
        { type: 'paying.breaker', action, cause: null, breaker: { ...closedBreaker() } },
        worker(),
      )
    expect((await breaker('pause')).result).toMatchObject({
      status: 'refused',
      code: 'paying_not_offered',
    })
    await world.owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'acct_route', 'connected', now(), 'restro', 'system', 'test-seed')
       on conflict do nothing`,
      [world.tenantId, world.venueId],
    )
    const state = async () =>
      (
        await world.owner.query<{ paused: boolean; alerts: string; pauses: string }>(
          `select (select paying_paused_at is not null from restro.payment_accounts
                    where venue_id = $1) as paused,
                  (select count(*) from restro.alerts where kind = $2 and subject_id = $1
                    and done_at is null)::text as alerts,
                  (select count(*) from restro.pauses where venue_id = $1)::text as pauses`,
          [world.venueId, PAYING_PAUSED_KIND],
        )
      ).rows[0]
    const pausesBefore = (await state())?.pauses
    expect((await breaker('pause')).result).toMatchObject({
      status: 'accepted',
      details: { paused: true, changed: true },
    })
    expect((await breaker('pause')).result).toMatchObject({ details: { changed: false } })
    expect((await breaker('progress')).result).toMatchObject({ details: { paused: true } })
    expect(await state()).toEqual({ paused: true, alerts: '1', pauses: pausesBefore })
    expect((await breaker('lift')).result).toMatchObject({
      details: { paused: false, changed: true },
    })
    expect(await state()).toEqual({ paused: false, alerts: '0', pauses: pausesBefore })
    const log = await world.owner.query<{ kind: string }>(
      `select kind from restro.log_entries where reason = $1 order by seq`,
      [PAYING_PAUSED_KIND],
    )
    expect(log.rows.map((row) => row.kind)).toEqual(['alert.raised', 'alert.done'])
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
