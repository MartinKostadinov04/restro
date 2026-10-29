// The payment answers of Tonight's server actions (#115), without a database: the command that is
// sent, that the worker is queued after an accepted answer and not after a refusal (or a queue that
// fails), and that Done is only the service path's to refuse for a payment question. Everything
// outside the action (the session, the venue, the command path, the queue) is a fake.
import { afterEach, describe, expect, it, vi } from 'vitest'

const runTableCommand = vi.hoisted(() => vi.fn())
const queuePaymentStep = vi.hoisted(() => vi.fn())

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
vi.mock('../staff/service', () => ({ identifyAtSharedDevice: vi.fn() }))
vi.mock('../venues', () => ({ getVenue: async (_tenant: string, id: string) => ({ id }) }))
vi.mock('../guest-api', () => ({ queuePaymentStep }))
vi.mock('./load', () => ({ loadTableBill: vi.fn() }))
vi.mock('./tables', () => ({ runTableCommand, markPaymentTable: vi.fn() }))

import {
  answerPaymentAction,
  closeTableAction,
  doneAlertAction,
  liftOrderingAction,
  openTableAction,
  pauseOrderingAction,
  receiptBroughtAction,
  receiptUnbroughtAction,
  undoOpenAllAction,
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
  const ok = { ok: true, details: {} }

  it('sends the token on with each inverse command, and none when there is none', async () => {
    const undo = { entry: 4821 }
    runTableCommand.mockResolvedValue(ok)
    await closeTableAction({ venueId: VENUE, tableId: TABLE, undo })
    await openTableAction({ venueId: VENUE, tableId: TABLE, undo })
    await pauseOrderingAction({ venueId: VENUE, barId: BAR, undo })
    await liftOrderingAction({ venueId: VENUE, pauseId: PAUSE, undo })
    await receiptUnbroughtAction({ venueId: VENUE, paymentId: PAYMENT, undo })
    await openTableAction({ venueId: VENUE, tableId: TABLE })
    expect(runTableCommand.mock.calls.map((call) => call[1])).toEqual([
      { type: 'table.close', tableId: TABLE, undo },
      { type: 'table.open', tableId: TABLE, undo },
      { type: 'ordering.pause', barId: BAR, undo },
      { type: 'ordering.lift', pauseId: PAUSE, undo },
      { type: 'receipt.unbrought', paymentId: PAYMENT, undo },
      { type: 'table.open', tableId: TABLE },
    ])
  })

  it('sends the token of Open all with the close of every table, and stops at the first refusal', async () => {
    const undo = { entry: 77 }
    const other = 'tb_ZYXWVUTSRQPONMLKJIHGFE'
    runTableCommand
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ok: false, error: 'undo_stale' })
    expect(
      await undoOpenAllAction({ venueId: VENUE, tableIds: [TABLE, other, TABLE], undo }),
    ).toEqual({ ok: false, error: 'undo_stale' })
    expect(runTableCommand.mock.calls.map((call) => call[1])).toEqual([
      { type: 'table.close', tableId: TABLE, undo },
      { type: 'table.close', tableId: other, undo },
    ])
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
