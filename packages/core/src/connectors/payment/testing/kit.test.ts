// The payment suite tested on itself: a small in-memory toy provider passes the checks, and each
// bug switched on is caught by the check that guards it. (The full suite runs on the simulated
// provider in `packages/payments/sim-pay`.)

import { describe, expect, it } from 'vitest'

import type { PaymentId } from '../../../ids'
import type { PaymentProvider, PaymentWriteOutcome } from '../provider'
import { type ProviderRef, providerRef } from '../provider-ref'
import { ProviderFormValuesSchema, type ProviderPayment } from '../schemas'
import {
  failedReadsCheck,
  idempotentCaptureCheck,
  idempotentCreateCheck,
  lostTimeoutCheck,
  moneyOnlyByCaptureCheck,
  oneCaptureCheck,
  operationsCheck,
  otherAccountCheck,
  type PaymentCheck,
  partialCaptureCheck,
  refundReadBackCheck,
  releaseCheck,
} from './checks'
import type { PaymentHarness } from './harness'

type Bug =
  | 'refundMethod'
  | 'doubleCapture'
  | 'captureAboveHold'
  | 'ignoresKey'
  | 'releaseMoves'
  | 'timeoutAsRefusal'
  | 'partialReadComplete'
  | 'refundAsDelta'
  | 'readsOtherAccount'

function toyHarness(bug?: Bug): PaymentHarness {
  const payments = new Map<string, ProviderPayment>()
  const keys = new Map<string, PaymentWriteOutcome<unknown>>()
  let moved = 0
  let counter = 0
  let lose = false
  let failReads = false
  const account = providerRef('toy_account')
  const otherAccount = providerRef('toy_other')
  /** The venue's refunds in its dashboard: the refund's ref to its payment's and its amount. */
  const refunds = new Map<string, { paymentRef: string; amountMinor: number }>()

  function once<R>(key: string, run: () => PaymentWriteOutcome<R>): PaymentWriteOutcome<R> {
    if (lose) {
      lose = false
      return bug === 'timeoutAsRefusal'
        ? { kind: 'refused', refusal: { code: 'capture_refused', scope: 'payment', detail: null } }
        : { kind: 'unknown', reason: 'timed out' }
    }
    const stored = keys.get(key)
    if (stored !== undefined && bug !== 'ignoresKey') return stored as PaymentWriteOutcome<R>
    const answer = run()
    keys.set(key, answer)
    return answer
  }
  const refused = (code: 'not_held' | 'already_captured' | 'amount_above_hold') =>
    ({ kind: 'refused', refusal: { code, scope: 'payment', detail: null } }) as const
  const update = (ref: string, change: Partial<ProviderPayment>): ProviderPayment => {
    const next = { ...(payments.get(ref) as ProviderPayment), ...change }
    payments.set(ref, next)
    return next
  }

  const provider: PaymentProvider & { refund?: () => void } = {
    kind: 'toy',
    capabilities: {
      holdDays: 7,
      partialCapture: true,
      wallets: [],
      refundNotices: false,
      minimumMinor: () => 50,
    },
    startConnection: async () => ({
      kind: 'done',
      result: { accountRef: account, redirectUrl: 'https://toy.test/onboard' },
    }),
    readConnection: async () =>
      failReads && bug !== 'partialReadComplete'
        ? { complete: false, reason: 'failed' }
        : { complete: true, value: { canTakePayments: true, displayName: null, missing: [] } },
    prepareDomain: async () => ({
      kind: 'refused',
      refusal: { code: 'not_supported', scope: 'account', detail: null },
    }),
    createHold: async (request) =>
      once(`hold:${request.idempotencyKey}`, () => {
        counter += 1
        const ref = providerRef(`toy_${counter}`)
        payments.set(ref.provider, {
          ref,
          paymentId: request.paymentId,
          status: 'awaiting_guest',
          needsGuestAction: false,
          currency: request.currency,
          amountMinor: request.amountMinor,
          heldMinor: 0,
          capturedMinor: 0,
          refundedMinor: 0,
          dispute: null,
          captureBefore: null,
          threeDs: null,
          authorisationCode: null,
        })
        return {
          kind: 'done',
          result: { paymentRef: ref, form: ProviderFormValuesSchema.parse({ ref: ref.provider }) },
        }
      }),
    findByPaymentId: async (_account: ProviderRef, paymentId: PaymentId) => {
      if (failReads && bug !== 'partialReadComplete') return { complete: false, reason: 'failed' }
      const found = [...payments.values()].filter((p) => p.paymentId === paymentId)
      return { complete: true, value: found.at(-1) ?? null }
    },
    readPayment: async (_account, paymentRef) => {
      if (failReads && bug !== 'partialReadComplete') return { complete: false, reason: 'failed' }
      const payment = payments.get(paymentRef.provider)
      return payment === undefined
        ? { complete: false, reason: 'no such payment' }
        : { complete: true, value: payment }
    },
    readNoticeSubject: async (accountRef, notice) => {
      if (failReads && bug !== 'partialReadComplete') return { complete: false, reason: 'failed' }
      const refund = notice.objectRef === null ? undefined : refunds.get(notice.objectRef.provider)
      if (refund === undefined) return { complete: true, value: null }
      if (accountRef.provider !== account.provider && bug !== 'readsOtherAccount') {
        return { complete: true, value: null }
      }
      const payment = payments.get(refund.paymentRef) as ProviderPayment
      const value =
        bug === 'refundAsDelta' ? { ...payment, refundedMinor: refund.amountMinor } : payment
      return { complete: true, value }
    },
    capture: async (request) =>
      once(`capture:${request.idempotencyKey}`, () => {
        const payment = payments.get(request.paymentRef.provider) as ProviderPayment
        if (payment.status === 'captured' && bug !== 'doubleCapture')
          return refused('already_captured')
        if (payment.status !== 'held' && payment.status !== 'captured') return refused('not_held')
        if (request.amountMinor > payment.amountMinor && bug !== 'captureAboveHold') {
          return refused('amount_above_hold')
        }
        moved += request.amountMinor
        return {
          kind: 'done',
          result: update(payment.ref.provider, {
            status: 'captured',
            heldMinor: 0,
            capturedMinor: request.amountMinor,
          }),
        }
      }),
    release: async (request) =>
      once(`release:${request.idempotencyKey}`, () => {
        const payment = payments.get(request.paymentRef.provider) as ProviderPayment
        if (payment.status === 'captured') return refused('already_captured')
        if (bug === 'releaseMoves') moved += 1
        return {
          kind: 'done',
          result: update(payment.ref.provider, { status: 'released', heldMinor: 0 }),
        }
      }),
  }
  if (bug === 'refundMethod') provider.refund = () => undefined

  return {
    name: `toy${bug === undefined ? '' : `, ${bug}`}`,
    provider,
    account,
    currency: 'EUR',
    guestHost: 'pay.toy.test',
    reset: () => {
      lose = false
      failReads = false
    },
    movedMinor: async () => moved,
    guest: {
      pay: async ({ paymentRef }) => {
        const payment = payments.get(paymentRef.provider) as ProviderPayment
        update(paymentRef.provider, {
          status: 'held',
          heldMinor: payment.amountMinor,
          captureBefore: '2026-11-01T21:00:00.000Z',
        })
      },
    },
    outside: {
      refundsInDashboard: async (_account, paymentRef, amountMinor) => {
        const payment = payments.get(paymentRef.provider) as ProviderPayment
        update(paymentRef.provider, { refundedMinor: payment.refundedMinor + amountMinor })
        const ref = `toy_refund_${refunds.size + 1}`
        refunds.set(ref, { paymentRef: paymentRef.provider, amountMinor })
        return {
          id: `toy_event_${refunds.size}`,
          type: 'refund.made',
          kind: 'refund',
          accountRef: account,
          objectRef: providerRef(ref),
        }
      },
    },
    otherAccount,
    faults: {
      timeOutBeforeLanding: () => {
        lose = true
      },
      failReads: () => {
        failReads = true
      },
    },
  }
}

const CASES: readonly [Bug | undefined, PaymentCheck][] = [
  [undefined, operationsCheck],
  [undefined, oneCaptureCheck],
  [undefined, partialCaptureCheck],
  [undefined, idempotentCreateCheck],
  [undefined, idempotentCaptureCheck],
  [undefined, releaseCheck],
  [undefined, moneyOnlyByCaptureCheck],
  [undefined, lostTimeoutCheck('capture')],
  [undefined, failedReadsCheck],
  [undefined, refundReadBackCheck],
  [undefined, otherAccountCheck],
  ['refundMethod', operationsCheck],
  ['doubleCapture', oneCaptureCheck],
  ['captureAboveHold', partialCaptureCheck],
  ['ignoresKey', idempotentCreateCheck],
  ['releaseMoves', releaseCheck],
  ['timeoutAsRefusal', lostTimeoutCheck('capture')],
  ['partialReadComplete', failedReadsCheck],
  ['refundAsDelta', refundReadBackCheck],
  ['readsOtherAccount', otherAccountCheck],
]

describe('the payment conformance suite on a toy provider', () => {
  for (const [index, [bug, check]] of CASES.entries()) {
    it(
      bug === undefined ? `a correct toy passes check ${index + 1}` : `catches ${bug}`,
      async () => {
        const problems = await check(toyHarness(bug))
        if (bug === undefined) expect(problems).toEqual([])
        else expect(problems).not.toEqual([])
      },
    )
  }

  it('names the refund method it found', async () => {
    expect(await operationsCheck(toyHarness('refundMethod'))).toEqual([
      'the provider offers refund, which is not a step of the payment interface',
    ])
  })
})
