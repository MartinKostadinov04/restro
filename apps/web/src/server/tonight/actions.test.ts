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

import { answerPaymentAction, doneAlertAction } from './actions'

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
