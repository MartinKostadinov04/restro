// The payment recovery's choices (#112), pure, on a clock: what one pass does about a payment from
// its state and how long nobody touched it. A payment the worker moves on is taken on again after a
// minute untouched and reported to Restro's team when it stays in the worker's own states for 10
// minutes; a payment at the card form is checked after a minute; one waiting for a payment table
// asks for one again; a hold past its capture deadline is read back while it waits for a table or a
// manager's answer; a refused release is read back
// later, never at once; a final payment and an answered one are left alone. The passes themselves
// run on Postgres in payments.test.ts and payment-route.test.ts.
import { describe, expect, it } from 'vitest'

import {
  PAYMENT_STALE_MS,
  PAYMENT_STUCK_MS,
  type RecoveryRow,
  recoveryActions,
} from '../src/jobs/payment-recovery'

const row = (partial: Partial<RecoveryRow>): RecoveryRow => ({
  state: 'priced',
  reason: null,
  paymentTableId: null,
  idleMs: 0,
  changedMs: 0,
  captureDue: false,
  releaseRefused: false,
  ...partial,
})

describe('one pass of the payment recovery', () => {
  it('takes a payment the worker moves on again after a minute untouched, not before', () => {
    for (const state of ['requested', 'priced', 'cancelling', 'isolated', 'checked', 'closed']) {
      expect(recoveryActions(row({ state, idleMs: PAYMENT_STALE_MS - 1 }))).toEqual([])
      expect(recoveryActions(row({ state, idleMs: PAYMENT_STALE_MS }))).toEqual(['prepare'])
    }
    // A payment waiting for a payment table asks for one again.
    for (const state of ['held', 'queued']) {
      expect(recoveryActions(row({ state, idleMs: PAYMENT_STALE_MS }))).toEqual(['prepare'])
    }
  })

  it("tells Restro's team about one still in the worker's own states 10 minutes after its last change", () => {
    const stale = { idleMs: PAYMENT_STALE_MS }
    for (const state of ['requested', 'priced', 'cancelling']) {
      expect(recoveryActions(row({ state, ...stale, changedMs: PAYMENT_STUCK_MS - 1 }))).toEqual([
        'prepare',
      ])
      expect(recoveryActions(row({ state, ...stale, changedMs: PAYMENT_STUCK_MS }))).toEqual([
        'prepare',
        'stuck',
      ])
    }
    // Moving on through the route is not stuck, however long it takes.
    expect(recoveryActions(row({ state: 'isolated', ...stale, changedMs: 3_600_000 }))).toEqual([
      'prepare',
    ])
  })

  it('checks a payment at the card form after a minute nobody looked at it', () => {
    expect(recoveryActions(row({ state: 'awaiting_guest', idleMs: PAYMENT_STALE_MS - 1 }))).toEqual(
      [],
    )
    expect(recoveryActions(row({ state: 'awaiting_guest', idleMs: PAYMENT_STALE_MS }))).toEqual([
      'check',
    ])
  })

  it('reads a hold past its capture deadline back while it waits for a table or an answer', () => {
    for (const state of ['held', 'queued']) {
      expect(recoveryActions(row({ state, captureDue: true }))).toEqual(['check'])
      expect(recoveryActions(row({ state, idleMs: PAYMENT_STALE_MS, captureDue: true }))).toEqual([
        'check',
      ])
    }
    for (const reason of ['close_unknown', 'close_refused', 'lines_not_back']) {
      expect(recoveryActions(row({ state: 'unconfirmed', reason, idleMs: 86_400_000 }))).toEqual([])
      expect(recoveryActions(row({ state: 'unconfirmed', reason, captureDue: true }))).toEqual([
        'check',
      ])
    }
  })

  it('reads a refused release back later, never releasing it at once', () => {
    expect(
      recoveryActions(row({ state: 'cancelling', releaseRefused: true, changedMs: 3_600_000 })),
    ).toEqual(['read_back_later'])
  })

  it('leaves a final payment and an answered one alone', () => {
    for (const state of ['captured', 'released', 'stranded', 'capture_failed']) {
      expect(recoveryActions(row({ state, idleMs: 86_400_000, captureDue: true }))).toEqual([])
    }
    // Answered "Receipt printed" or "No receipt": the route goes on from the answer.
    for (const reason of ['receipt_printed', 'no_receipt']) {
      expect(
        recoveryActions(row({ state: 'unconfirmed', reason, idleMs: PAYMENT_STALE_MS })),
      ).toEqual(['prepare'])
    }
  })
})
