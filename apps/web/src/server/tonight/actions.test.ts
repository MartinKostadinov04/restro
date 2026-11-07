// The payment answers of Tonight's server actions (#115), without a database: the command that is
// sent, that the worker is queued after an accepted answer and not after a refusal (or a queue that
// fails), and that Done is only the service path's to refuse for a payment question. Everything
// outside the action (the session, the venue, the command path, the queue) is a fake.
import { afterEach, describe, expect, it, vi } from 'vitest'

const runTableCommand = vi.hoisted(() => vi.fn())
const queuePaymentStep = vi.hoisted(() => vi.fn())
const identifyAtSharedDevice = vi.hoisted(() => vi.fn())
const getVenue = vi.hoisted(() =>
  vi.fn(async (_tenant: string, id: string): Promise<{ id: string } | null> => ({ id })),
)

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../db', () => ({ getPool: () => ({}) }))
vi.mock('../jobs', () => ({ enqueueJob: vi.fn() }))
vi.mock('../log', () => ({ logError: vi.fn() }))
vi.mock('../session', () => ({
  requireTenant: async () => ({
    organization: { id: 'tn_0123456789ABCDEFGHIJKL' },
    user: { id: 'us_1' },
    sessionId: 'sess-1',
    signedInAt: new Date('2026-10-29T20:00:00Z'),
  }),
}))
vi.mock('../staff/service', () => ({
  identifyAtSharedDevice,
  ownActor: (user: { id: string }, sessionId: string, options?: { asOperator?: boolean }) =>
    options?.asOperator === true
      ? { kind: 'operator', userId: user.id }
      : { kind: 'user', userId: user.id, sessionId },
}))
vi.mock('../venues', () => ({ getVenue }))
vi.mock('../guest-api', () => ({ queuePaymentStep }))
vi.mock('./load', () => ({ loadTableBill: vi.fn() }))
vi.mock('./tables', () => ({ runTableCommand, markPaymentTable: vi.fn() }))

import {
  answerPaymentAction,
  closeAllTablesAction,
  closeTableAction,
  doneAlertAction,
  liftOrderingAction,
  liftRestroPauseAction,
  openAllTablesAction,
  openTableAction,
  pauseOrderingAction,
  receiptBroughtAction,
  receiptUnbroughtAction,
  stornoDoneAction,
  stornoUndoAction,
  undoOpenAllAction,
  undoPauseAction,
  undoWaiterCallAction,
} from './actions'

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const PAYMENT = 'py_0123456789ABCDEFGHIJKL'
const ALERT = 'al_0123456789ABCDEFGHIJKL'

afterEach(() => {
  runTableCommand.mockReset()
  queuePaymentStep.mockReset()
})

describe('answering a payment question', () => {
  const input = {
    venueId: VENUE,
    paymentId: PAYMENT,
    answering: 'close',
    answer: 'receipt_printed',
  }

  it('sends the answer, then queues the worker for the payment', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: true,
      details: {
        paymentId: PAYMENT,
        state: 'unconfirmed',
        changed: true,
        answer: 'receipt_printed',
      },
    })
    const result = await answerPaymentAction(input)
    expect(result.ok).toBe(true)
    expect(runTableCommand.mock.calls[0]?.[1]).toEqual({
      type: 'payment.answer',
      paymentId: PAYMENT,
      answering: 'close',
      answer: 'receipt_printed',
    })
    expect(queuePaymentStep).toHaveBeenCalledWith(
      { tenantId: 'tn_0123456789ABCDEFGHIJKL', venueId: VENUE, paymentId: PAYMENT },
      'prepare',
    )
  })

  it('queues the worker for a pay-first round the manager says is on the till', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: true,
      details: { paymentId: PAYMENT, state: 'entered', changed: true, answer: 'on_till' },
    })
    await answerPaymentAction({ ...input, answer: 'on_till' })
    expect(queuePaymentStep).toHaveBeenCalledTimes(1)
  })

  it('queues nothing when someone answered first', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: false,
      error: 'payment_answered',
      details: { answer: 'no_receipt' },
    })
    const result = await answerPaymentAction(input)
    expect(result).toMatchObject({ ok: false, error: 'payment_answered' })
    expect(queuePaymentStep).not.toHaveBeenCalled()
  })

  it('keeps the answer when the queue is down: the recovery tick picks it up', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: true,
      details: {
        paymentId: PAYMENT,
        state: 'unconfirmed',
        changed: true,
        answer: 'receipt_printed',
      },
    })
    queuePaymentStep.mockRejectedValueOnce(new Error('the queue is down'))
    expect((await answerPaymentAction(input)).ok).toBe(true)
  })

  it('refuses an answer that is not one of the four, before any command', async () => {
    expect(await answerPaymentAction({ ...input, answer: 'maybe' })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(runTableCommand).not.toHaveBeenCalled()
  })
})

describe('acknowledging an alert (Moved back, Seen, Sorted)', () => {
  it('sends alert.done for the alert', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: true,
      details: { state: 'done', changed: true, kind: 'payment_stranded' },
    })
    const result = await doneAlertAction({ venueId: VENUE, alertId: ALERT })
    expect(result.ok).toBe(true)
    expect(runTableCommand.mock.calls[0]?.[1]).toEqual({ type: 'alert.done', alertId: ALERT })
    expect(queuePaymentStep).not.toHaveBeenCalled()
  })

  it('sends no command for a venue the organisation cannot see', async () => {
    getVenue.mockResolvedValueOnce(null)
    expect(await doneAlertAction({ venueId: VENUE, alertId: ALERT })).toEqual({
      ok: false,
      error: 'venue_missing',
    })
    expect(runTableCommand).not.toHaveBeenCalled()
    expect(queuePaymentStep).not.toHaveBeenCalled()
  })

  it("passes on the service path's refusal of Done on a payment question", async () => {
    runTableCommand.mockResolvedValueOnce({ ok: false, error: 'alert_needs_answer' })
    expect(await doneAlertAction({ venueId: VENUE, alertId: ALERT })).toEqual({
      ok: false,
      error: 'alert_needs_answer',
    })
  })
})

describe('marking a paper receipt Brought (#200)', () => {
  it('sends receipt.brought with no PIN, and passes on what the service path answered', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: true,
      details: { paymentId: PAYMENT, brought: true, changed: true },
    })
    expect(await receiptBroughtAction({ venueId: VENUE, paymentId: PAYMENT })).toEqual({
      ok: true,
      details: { paymentId: PAYMENT, brought: true, changed: true },
    })
    expect(runTableCommand.mock.calls[0]?.[1]).toEqual({
      type: 'receipt.brought',
      paymentId: PAYMENT,
    })
    expect(queuePaymentStep).not.toHaveBeenCalled()
  })

  it('sends receipt.unbrought for Undo, and passes on a refusal', async () => {
    runTableCommand.mockResolvedValueOnce({ ok: false, error: 'no_receipt_to_bring' })
    expect(await receiptUnbroughtAction({ venueId: VENUE, paymentId: PAYMENT })).toEqual({
      ok: false,
      error: 'no_receipt_to_bring',
    })
    expect(runTableCommand.mock.calls[0]?.[1]).toEqual({
      type: 'receipt.unbrought',
      paymentId: PAYMENT,
    })
  })

  it('refuses a PIN, a payment id of another kind, or an extra field, before any command', async () => {
    for (const input of [
      { venueId: VENUE, paymentId: PAYMENT, pin: '1234' },
      { venueId: VENUE, paymentId: ALERT },
      { venueId: VENUE },
    ]) {
      expect(await receiptBroughtAction(input)).toEqual({ ok: false, error: 'invalid' })
    }
    expect(runTableCommand).not.toHaveBeenCalled()
  })
})

describe('the undo token of a staff Undo (#219)', () => {
  const TABLE = 'tb_0123456789ABCDEFGHIJKL'
  const PAUSE = 'pa_0123456789ABCDEFGHIJKL'
  const BAR = 'br_0123456789ABCDEFGHIJKL'
  const CALL = 'wc_0123456789ABCDEFGHIJKL'
  const ok = { ok: true, details: {} }

  it('refuses an Undo of a pause or of Handled without its token, and a lift with one', async () => {
    runTableCommand.mockResolvedValue(ok)
    const invalid = { ok: false, error: 'invalid' }
    expect(await undoPauseAction({ venueId: VENUE, pauseId: PAUSE })).toEqual(invalid)
    expect(await undoWaiterCallAction({ venueId: VENUE, waiterCallId: CALL })).toEqual(invalid)
    expect(
      await liftOrderingAction({ venueId: VENUE, pauseId: PAUSE, undo: { entry: 1 } }),
    ).toEqual(invalid)
    expect(runTableCommand).not.toHaveBeenCalled()
  })

  it('lifts a Restro pause as the Restro team, never as the person at the venue (D120)', async () => {
    runTableCommand.mockResolvedValue(ok)
    await liftRestroPauseAction({ venueId: VENUE, pauseId: PAUSE })
    const [scope, command] = runTableCommand.mock.calls[0] as [{ actor: unknown }, unknown]
    expect(command).toEqual({ type: 'ordering.lift', pauseId: PAUSE })
    expect(scope.actor).toEqual({ kind: 'operator', userId: 'us_1' })
    // A PIN is no way in: only the session's own grant, which the command path checks.
    expect(await liftRestroPauseAction({ venueId: VENUE, pauseId: PAUSE, pin: '1234' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('names whom the PIN named, and nobody on a person’s own session', async () => {
    runTableCommand.mockResolvedValue({ ok: true, details: { changed: true } })
    identifyAtSharedDevice.mockResolvedValue({
      ok: true,
      staffMemberId: 'st_1',
      name: 'Ivana',
      deviceId: 'dv_1',
    })
    expect(await liftOrderingAction({ venueId: VENUE, pauseId: PAUSE, pin: '1234' })).toEqual({
      ok: true,
      details: { changed: true, who: 'Ivana' },
    })
    expect(await liftOrderingAction({ venueId: VENUE, pauseId: PAUSE })).toEqual({
      ok: true,
      details: { changed: true },
    })
  })

  it('sends the token on with each inverse command, and none when there is none', async () => {
    const undo = { entry: 4821 }
    runTableCommand.mockResolvedValue(ok)
    await closeTableAction({ venueId: VENUE, tableId: TABLE, undo })
    await openTableAction({ venueId: VENUE, tableId: TABLE, undo })
    await pauseOrderingAction({ venueId: VENUE, barId: BAR, undo })
    await undoPauseAction({ venueId: VENUE, pauseId: PAUSE, undo })
    await undoWaiterCallAction({ venueId: VENUE, waiterCallId: CALL, undo })
    await receiptUnbroughtAction({ venueId: VENUE, paymentId: PAYMENT, undo })
    await openTableAction({ venueId: VENUE, tableId: TABLE })
    expect(runTableCommand.mock.calls.map((call) => call[1])).toEqual([
      { type: 'table.close', tableId: TABLE, undo },
      { type: 'table.open', tableId: TABLE, undo },
      { type: 'ordering.pause', barId: BAR, undo },
      { type: 'ordering.undo_pause', pauseId: PAUSE, undo },
      { type: 'waiter_call.undone', waiterCallId: CALL, undo },
      { type: 'receipt.unbrought', paymentId: PAYMENT, undo },
      { type: 'table.open', tableId: TABLE },
    ])
  })

  it('undoes Open all with one command that carries only its token', async () => {
    const undo = { entry: 77 }
    runTableCommand.mockResolvedValueOnce({ ok: true, details: { closed: 4, skipped: 0 } })
    expect(await undoOpenAllAction({ venueId: VENUE, undo })).toEqual({
      ok: true,
      details: { closed: 4, skipped: 0 },
    })
    expect(runTableCommand).toHaveBeenCalledTimes(1)
    expect(runTableCommand.mock.calls[0]?.[1]).toEqual({ type: 'tables.undo_open_all', undo })
  })

  it('passes on the refusal of an Open all a guest has used, with the tables it names', async () => {
    runTableCommand.mockResolvedValueOnce({
      ok: false,
      error: 'undo_stale',
      details: { count: 1, tables: TABLE },
    })
    expect(await undoOpenAllAction({ venueId: VENUE, undo: { entry: 77 } })).toEqual({
      ok: false,
      error: 'undo_stale',
      details: { count: 1, tables: TABLE },
    })
  })

  it("refuses Open all's Undo without a token, or with a list of tables, before any command", async () => {
    for (const input of [
      { venueId: VENUE },
      { venueId: VENUE, undo: { entry: 77 }, tableIds: [TABLE] },
    ]) {
      expect(await undoOpenAllAction(input)).toEqual({ ok: false, error: 'invalid' })
    }
    expect(runTableCommand).not.toHaveBeenCalled()
  })

  it('passes on the two refusals as they are', async () => {
    for (const error of ['undo_expired', 'undo_stale']) {
      runTableCommand.mockResolvedValueOnce({ ok: false, error })
      expect(
        await closeTableAction({ venueId: VENUE, tableId: TABLE, undo: { entry: 1 } }),
      ).toEqual({ ok: false, error })
    }
  })

  it('refuses a token that is not a Log entry number before any command', async () => {
    for (const undo of [{ entry: 0 }, { entry: 1.5 }, { entry: '4' }, { entry: 1, at: 'x' }]) {
      expect(await closeTableAction({ venueId: VENUE, tableId: TABLE, undo })).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(runTableCommand).not.toHaveBeenCalled()
  })
})

describe('"Storno done" (#222)', () => {
  const REFUND = 'rf_0123456789ABCDEFGHIJKL'

  it('sends the answer of the refund, and the Undo with its token', async () => {
    runTableCommand.mockResolvedValue({ ok: true, details: { refundId: REFUND, changed: true } })
    await stornoDoneAction({ venueId: VENUE, refundId: REFUND })
    await stornoUndoAction({ venueId: VENUE, refundId: REFUND, undo: { entry: 4821 } })
    expect(runTableCommand.mock.calls.map((call) => call[1])).toEqual([
      { type: 'payment.storno_done', refundId: REFUND },
      { type: 'payment.storno_undo', refundId: REFUND, undo: { entry: 4821 } },
    ])
    // An Undo without the token it was answered with is refused before any command.
    expect(await stornoUndoAction({ venueId: VENUE, refundId: REFUND })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(runTableCommand).toHaveBeenCalledTimes(2)
    expect(queuePaymentStep).not.toHaveBeenCalled()
  })

  it('passes a second answer on as refused', async () => {
    runTableCommand.mockResolvedValueOnce({ ok: false, error: 'storno_answered' })
    expect(await stornoDoneAction({ venueId: VENUE, refundId: REFUND })).toEqual({
      ok: false,
      error: 'storno_answered',
    })
  })

  it('refuses an id of another kind or an extra field before any command', async () => {
    for (const input of [
      { venueId: VENUE, refundId: PAYMENT },
      { venueId: VENUE },
      { venueId: VENUE, refundId: REFUND, amountMinor: 100 },
      { venueId: VENUE, refundId: REFUND, pin: '12' },
    ]) {
      expect(await stornoDoneAction(input)).toEqual({ ok: false, error: 'invalid' })
    }
    expect(runTableCommand).not.toHaveBeenCalled()
  })
})

describe('a venue the organisation cannot see (the `venue_missing` guard, RR-42)', () => {
  // Another organisation's venue and a made-up id both come back from `getVenue` as null (row-level
  // security). Every action goes through the same guard: none reaches the service path.
  const TABLE = 'tb_0123456789ABCDEFGHIJKL'
  const BAR = 'br_0123456789ABCDEFGHIJKL'
  const actions: [string, () => Promise<unknown>][] = [
    ['open a table', () => openTableAction({ venueId: VENUE, tableId: TABLE })],
    ['close a table', () => closeTableAction({ venueId: VENUE, tableId: TABLE })],
    ['open all tables', () => openAllTablesAction({ venueId: VENUE })],
    ['close all tables', () => closeAllTablesAction({ venueId: VENUE })],
    ['pause ordering', () => pauseOrderingAction({ venueId: VENUE, barId: BAR })],
    [
      'answer a payment question',
      () =>
        answerPaymentAction({
          venueId: VENUE,
          paymentId: PAYMENT,
          answering: 'close',
          answer: 'receipt_printed',
        }),
    ],
    ['mark a receipt Brought', () => receiptBroughtAction({ venueId: VENUE, paymentId: PAYMENT })],
  ]

  it.each(actions)(
    'refuses to %s, asking for the venue in the signed-in organisation',
    async (_, run) => {
      getVenue.mockClear()
      getVenue.mockResolvedValueOnce(null)
      expect(await run()).toEqual({ ok: false, error: 'venue_missing' })
      expect(getVenue).toHaveBeenCalledWith('tn_0123456789ABCDEFGHIJKL', VENUE)
      expect(runTableCommand).not.toHaveBeenCalled()
      expect(queuePaymentStep).not.toHaveBeenCalled()
    },
  )
})
