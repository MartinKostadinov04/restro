import { describe, expect, it } from 'vitest'

import { PaymentIntentSchema, type StripeCharge, type StripePaymentIntent } from './api'
import {
  connectionStatus,
  disputeState,
  paymentStatus,
  providerPayment,
  threeDsResult,
} from './mapping'

const PAYMENT_ID = 'py_0123456789abcdefghijkl'

function intent(fields: Record<string, unknown> = {}): StripePaymentIntent {
  return PaymentIntentSchema.parse({
    id: 'pi_3Test',
    object: 'payment_intent',
    status: 'requires_payment_method',
    amount: 1050,
    amount_capturable: 0,
    amount_received: 0,
    currency: 'eur',
    metadata: { restro_payment: PAYMENT_ID },
    last_payment_error: null,
    ...fields,
  })
}

function charge(fields: Partial<StripeCharge> = {}): StripeCharge {
  return {
    id: 'ch_3Test',
    object: 'charge',
    payment_intent: 'pi_3Test',
    amount_refunded: 0,
    payment_method_details: {
      card: {
        capture_before: 1_793_000_000,
        authorization_code: '123456',
        three_d_secure: null,
      },
    },
    ...fields,
  }
}

describe('paymentStatus', () => {
  it("maps each PaymentIntent status to the platform's", () => {
    expect(paymentStatus(intent())).toBe('awaiting_guest')
    expect(paymentStatus(intent({ last_payment_error: { code: 'card_declined' } }))).toBe('failed')
    expect(paymentStatus(intent({ status: 'requires_confirmation' }))).toBe('awaiting_guest')
    expect(paymentStatus(intent({ status: 'requires_action' }))).toBe('awaiting_guest')
    expect(paymentStatus(intent({ status: 'processing' }))).toBe('awaiting_guest')
    expect(paymentStatus(intent({ status: 'requires_capture' }))).toBe('held')
    expect(paymentStatus(intent({ status: 'succeeded' }))).toBe('captured')
    expect(paymentStatus(intent({ status: 'canceled' }))).toBe('released')
    expect(paymentStatus(intent({ status: 'something_new' }))).toBeNull()
  })
})

describe('disputeState (#108)', () => {
  it('reads warnings and disputes under way as open, the outcomes as they are', () => {
    for (const status of [
      'warning_needs_response',
      'warning_under_review',
      'needs_response',
      'under_review',
    ]) {
      expect(disputeState(status)).toBe('open')
    }
    expect(disputeState('won')).toBe('won')
    expect(disputeState('lost')).toBe('lost')
  })

  it('reads a closed inquiry and a prevented dispute as no dispute, a new status as unknown', () => {
    expect(disputeState('warning_closed')).toBeNull()
    expect(disputeState('prevented')).toBeNull()
    expect(disputeState('something_new')).toBe('unknown')
  })
})

describe('threeDsResult', () => {
  it("maps the bank's result, and none for data shared only", () => {
    expect(threeDsResult('authenticated')).toBe('authenticated')
    expect(threeDsResult('attempt_acknowledged')).toBe('attempted')
    expect(threeDsResult('processing_error')).toBe('error')
    expect(threeDsResult('data_share_only')).toBeNull()
    expect(threeDsResult(null)).toBeNull()
  })
})

describe('providerPayment', () => {
  it('reads a held payment with its hold deadline and code', () => {
    const mapped = providerPayment(
      intent({ status: 'requires_capture', amount_capturable: 1050 }),
      charge(),
      null,
    )
    expect(mapped).toEqual({
      ok: true,
      value: expect.objectContaining({
        paymentId: PAYMENT_ID,
        status: 'held',
        currency: 'EUR',
        amountMinor: 1050,
        heldMinor: 1050,
        capturedMinor: 0,
        refundedMinor: 0,
        dispute: null,
        captureBefore: new Date(1_793_000_000 * 1000).toISOString(),
        authorisationCode: '123456',
        needsGuestAction: false,
      }),
    })
  })

  it('reads a partly captured payment with the refunds made on its charge, and its dispute', () => {
    const mapped = providerPayment(
      intent({ status: 'succeeded', amount_received: 750 }),
      charge({ amount_refunded: 500 }),
      'open',
    )
    expect(mapped.ok && mapped.value).toMatchObject({
      status: 'captured',
      heldMinor: 0,
      capturedMinor: 750,
      refundedMinor: 500,
      dispute: 'open',
    })
  })

  it('says a payment whose bank asks for a step needs the guest', () => {
    const mapped = providerPayment(intent({ status: 'requires_action' }), null, null)
    expect(mapped.ok && mapped.value.needsGuestAction).toBe(true)
  })

  it('reads a payment that is not ours, or of an unknown status, as unmapped', () => {
    expect(providerPayment(intent({ metadata: {} }), null, null).ok).toBe(false)
    expect(providerPayment(intent({ status: 'something_new' }), null, null).ok).toBe(false)
    expect(providerPayment(intent({ currency: 'usd' }), null, null).ok).toBe(false)
  })
})

describe('connectionStatus', () => {
  it('takes payments once card payments are active, and names what is missing', () => {
    const account = (status: string, descriptions: string[]) => ({
      id: 'acct_1',
      configuration: { merchant: { capabilities: { card_payments: { status } } } },
      requirements: {
        entries: descriptions.map((description) => ({ description, awaiting_action_from: 'user' })),
      },
    })
    expect(connectionStatus(account('active', []))).toEqual({
      ok: true,
      value: { canTakePayments: true, missing: [] },
    })
    expect(
      connectionStatus(account('restricted', ['business_type', 'business_type', 'tos_acceptance'])),
    ).toEqual({
      ok: true,
      value: { canTakePayments: false, missing: ['business_type', 'tos_acceptance'] },
    })
    expect(connectionStatus({ id: 'acct_1' })).toEqual({
      ok: true,
      value: { canTakePayments: false, missing: [] },
    })
  })
})
