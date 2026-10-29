import { describe, expect, it } from 'vitest'

import { PaymentIntentSchema, type StripeCharge, type StripePaymentIntent } from './api'
import {
  connectionStatus,
  disputeDueAt,
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

describe('disputeDueAt (#222)', () => {
  const dispute = (due_by: number | null | undefined) =>
    ({
      id: 'dp_1',
      object: 'dispute' as const,
      status: 'needs_response',
      created: 1_793_000_000,
      evidence_details: due_by === undefined ? undefined : { due_by },
    }) as Parameters<typeof disputeDueAt>[0]

  it("reads the answer-by date from the dispute's evidence details", () => {
    expect(disputeDueAt(dispute(1_794_000_000))).toBe(new Date(1_794_000_000 * 1000).toISOString())
  })

  it('reads none where Stripe gives none, never a date in 1970', () => {
    expect(disputeDueAt(dispute(0))).toBeNull()
    expect(disputeDueAt(dispute(null))).toBeNull()
    expect(disputeDueAt(dispute(undefined))).toBeNull()
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

  it('carries the dispute’s answer-by date only with a dispute on a captured payment', () => {
    const due = '2026-11-12T09:00:00.000Z'
    const captured = intent({ status: 'succeeded', amount_received: 750 })
    const open = providerPayment(captured, charge(), 'open', due)
    expect(open.ok && open.value.disputeDueAt).toBe(due)
    const none = providerPayment(captured, charge(), null, due)
    expect(none.ok && none.value.disputeDueAt).toBeNull()
    const held = providerPayment(
      intent({ status: 'requires_capture', amount_capturable: 1050 }),
      charge(),
      'open',
      due,
    )
    expect(held.ok && held.value.disputeDueAt).toBeNull()
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
      value: { canTakePayments: true, displayName: null, missing: [] },
    })
    expect(
      connectionStatus(account('restricted', ['business_type', 'business_type', 'tos_acceptance'])),
    ).toEqual({
      ok: true,
      value: {
        canTakePayments: false,
        displayName: null,
        missing: ['business_type', 'tos_acceptance'],
      },
    })
    expect(connectionStatus({ id: 'acct_1' })).toEqual({
      ok: true,
      value: { canTakePayments: false, displayName: null, missing: [] },
    })
  })

  it('takes the account’s display name, trimmed, and null where it has none or a blank one (#109)', () => {
    const named = (display_name: string | null | undefined) =>
      connectionStatus({ id: 'acct_1', display_name })
    expect(named('  Club Nova  ')).toMatchObject({ ok: true, value: { displayName: 'Club Nova' } })
    for (const none of [null, undefined, '', '   ']) {
      expect(named(none), String(none)).toMatchObject({ ok: true, value: { displayName: null } })
    }
    expect(named('x'.repeat(300))).toMatchObject({
      ok: true,
      value: { displayName: 'x'.repeat(200) },
    })
  })
})
