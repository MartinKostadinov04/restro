// Several card payments on one close (D160 §3, #541): the payments add up to the close in integer
// minor units (rule 8, a property test), a close with none is a list of one, and any one
// payment's reference proves the whole close.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { closeProof } from './landed'
import { posRef } from './pos-ref'
import {
  CLOSE_PAYMENTS_MAX,
  type ClosePayment,
  closePaymentsOf,
  closePaymentsProblem,
  PayAndCloseRequestSchema,
} from './schemas'

const isolated = { ref: posRef('b1'), table: posRef('pt1') }

/** Payments with distinct references, each tip inside its amount. */
const paymentsArb = fc
  .array(
    fc
      .record({ amountMinor: fc.integer({ min: 1, max: 5_000_000 }), tipShare: fc.nat(100) })
      .map(({ amountMinor, tipShare }) => ({
        amountMinor,
        tipMinor: Math.floor((amountMinor * tipShare) / 100),
      })),
    { minLength: 1, maxLength: CLOSE_PAYMENTS_MAX },
  )
  .map((parts): ClosePayment[] => parts.map((part, index) => ({ ...part, ref: `py_${index + 1}` })))

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

function request(payments: readonly ClosePayment[], amountMinor: number, tipMinor: number) {
  return {
    isolated,
    amountMinor,
    tipMinor,
    paymentType: null,
    payments: [...payments],
    ref: 'py_close',
  }
}

describe('a close with several card payments (D160 §3, rule 8)', () => {
  it('is taken exactly when its payments sum to its amount and their tips to its tip', () => {
    fc.assert(
      fc.property(
        paymentsArb,
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (payments, amountOff, tipOff) => {
          const amountMinor = sum(payments.map((p) => p.amountMinor)) + amountOff
          const tipMinor = sum(payments.map((p) => p.tipMinor)) + tipOff
          fc.pre(amountMinor >= 0 && tipMinor >= 0 && tipMinor <= amountMinor)
          const close = request(payments, amountMinor, tipMinor)
          const addsUp = amountOff === 0 && tipOff === 0
          expect(closePaymentsProblem(close) === null).toBe(addsUp)
          expect(PayAndCloseRequestSchema.safeParse(close).success).toBe(addsUp)
        },
      ),
      { numRuns: 300 },
    )
  })

  it("refuses a repeated reference, a tip above its payment's amount and a payment of 0", () => {
    const one = { amountMinor: 500, tipMinor: 0, ref: 'py_1' }
    expect(closePaymentsProblem(request([one, { ...one }], 1000, 0))).toMatch(/same reference/)
    const tipOver = [{ amountMinor: 500, tipMinor: 600, ref: 'py_1' }]
    expect(closePaymentsProblem(request(tipOver, 500, 600))).toMatch(/tip is above/)
    const zero = [one, { amountMinor: 0, tipMinor: 0, ref: 'py_2' }]
    expect(PayAndCloseRequestSchema.safeParse(request(zero, 500, 0)).success).toBe(false)
  })

  it('refuses more payments than a close carries, and sums past the safe range', () => {
    const many = Array.from({ length: CLOSE_PAYMENTS_MAX + 1 }, (_, index) => ({
      amountMinor: 1,
      tipMinor: 0,
      ref: `py_${index}`,
    }))
    expect(closePaymentsProblem(request(many, many.length, 0))).toMatch(/more than/)
    const huge = [
      { amountMinor: Number.MAX_SAFE_INTEGER, tipMinor: 0, ref: 'py_1' },
      { amountMinor: 1, tipMinor: 0, ref: 'py_2' },
    ]
    expect(closePaymentsProblem(request(huge, 0, 0))).toMatch(/do not add up/)
  })

  it('a close that names no payments is one payment of its own amount, tip and reference', () => {
    const single = { isolated, amountMinor: 1200, tipMinor: 200, paymentType: null, ref: 'py_1' }
    expect(closePaymentsOf(single)).toStrictEqual([
      { amountMinor: 1200, tipMinor: 200, ref: 'py_1' },
    ])
    expect(closePaymentsProblem(single)).toBeNull()
    expect(PayAndCloseRequestSchema.safeParse(single).success).toBe(true)
  })
})

describe("a close's third proof by a card payment's reference (D127 3.10, D160 §3)", () => {
  const closed = {
    ref: posRef('b1'),
    totalMinor: 3000,
    receiptNumber: null,
    restroRefs: [],
    paymentRefs: ['py_1', 'py_2', 'py_3'],
  }

  it('any one of its payments proves the whole close', () => {
    for (const ref of closed.paymentRefs) {
      expect(closeProof(closed, { refs: new Set([ref]), amountMinor: 3000 })).toEqual({
        receiptNumber: null,
      })
    }
  })

  it('another total, or a payment not of this close, proves nothing', () => {
    expect(closeProof(closed, { refs: new Set(['py_1']), amountMinor: 1000 })).toBeNull()
    expect(closeProof(closed, { refs: new Set(['py_9']), amountMinor: 3000 })).toBeNull()
  })
})
