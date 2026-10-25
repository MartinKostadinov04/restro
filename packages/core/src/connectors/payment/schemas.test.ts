import { describe, expect, it } from 'vitest'

import { newId } from '../../ids'
import { paymentCapabilitiesProblems } from './capabilities'
import { providerRef } from './provider-ref'
import {
  IdempotencyKeySchema,
  PAYMENT_ANSWER_SCHEMAS,
  PaymentRefusalSchema,
  ProviderFormValuesSchema,
  ProviderNoticeSchema,
  ProviderPaymentSchema,
} from './schemas'

const held = {
  ref: providerRef('pay_1'),
  paymentId: newId('py'),
  status: 'held',
  needsGuestAction: false,
  currency: 'EUR',
  amountMinor: 2_450,
  heldMinor: 2_450,
  capturedMinor: 0,
  refundedMinor: 0,
  dispute: null,
  captureBefore: '2026-11-01T21:00:00.000Z',
  threeDs: 'authenticated',
  authorisationCode: 'A1B2C3',
}

describe('the provider payment', () => {
  it('accepts a payment whose amounts match its status', () => {
    expect(ProviderPaymentSchema.safeParse(held).success).toBe(true)
    const captured = { ...held, status: 'captured', heldMinor: 0, capturedMinor: 2_000 }
    expect(ProviderPaymentSchema.safeParse(captured).success).toBe(true)
    // A refund and a dispute read back as they stand: the total refunded, the dispute's state.
    const refunded = { ...captured, refundedMinor: 2_000, dispute: 'lost' }
    expect(ProviderPaymentSchema.safeParse(refunded).success).toBe(true)
  })

  it('refuses a capture above the hold, a held amount outside held, and a guest step outside awaiting', () => {
    const bad = [
      { ...held, status: 'captured', heldMinor: 0, capturedMinor: 2_451 },
      { ...held, status: 'released' },
      { ...held, heldMinor: 0 },
      { ...held, status: 'captured', heldMinor: 0, capturedMinor: 0 },
      { ...held, needsGuestAction: true },
      { ...held, capturedMinor: 10 },
      { ...held, amountMinor: 24.5 },
      { ...held, ref: { provider: 'pay_1' }, paymentId: 'pay_1' },
      { ...held, refundedMinor: 1 },
      { ...held, dispute: 'open' },
      { ...held, status: 'captured', heldMinor: 0, capturedMinor: 2_000, refundedMinor: 2_001 },
      {
        ...held,
        status: 'captured',
        heldMinor: 0,
        capturedMinor: 2_000,
        dispute: 'needs_response',
      },
    ]
    for (const payment of bad) {
      expect(ProviderPaymentSchema.safeParse(payment).success, JSON.stringify(payment)).toBe(false)
    }
  })

  it('carries no POS refusal and no refund code', () => {
    expect(
      PaymentRefusalSchema.safeParse({ code: 'bill_closed', scope: 'payment', detail: null })
        .success,
    ).toBe(false)
    expect(JSON.stringify(PaymentRefusalSchema.shape.code.options)).not.toMatch(/refund/)
  })

  it('reads a timeout as unknown and a partial reading as incomplete', () => {
    expect(
      PAYMENT_ANSWER_SCHEMAS.capture.safeParse({ kind: 'unknown', reason: 'timed out' }).success,
    ).toBe(true)
    expect(
      PAYMENT_ANSWER_SCHEMAS.readPayment.safeParse({ complete: false, reason: 'page 2 failed' })
        .success,
    ).toBe(true)
    expect(
      PAYMENT_ANSWER_SCHEMAS.readPayment.safeParse({ complete: false, value: held }).success,
    ).toBe(false)
  })
})

describe('the provider notice', () => {
  const notice = {
    id: 'evt_1',
    type: 'charge.refunded',
    kind: 'refund',
    accountRef: providerRef('acct_1'),
    objectRef: providerRef('ch_1'),
  }

  it("takes a pointer in the platform's words: a kind, an account and an object", () => {
    expect(ProviderNoticeSchema.safeParse(notice).success).toBe(true)
    expect(
      ProviderNoticeSchema.safeParse({
        ...notice,
        kind: 'other',
        accountRef: null,
        objectRef: null,
      }).success,
    ).toBe(true)
  })

  it("refuses a provider's event type as the kind, a body's amounts, and odd ids", () => {
    for (const bad of [
      { ...notice, kind: 'charge.refunded' },
      { ...notice, amountMinor: 500 },
      { ...notice, id: '' },
      { ...notice, id: 'evt 1' },
      { ...notice, type: 'x'.repeat(129) },
      { ...notice, objectRef: 'ch_1' },
    ]) {
      expect(ProviderNoticeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('the idempotency key', () => {
  it('takes what the database stores: a first character alphanumeric, at most 200', () => {
    for (const key of ['py_1:hold:0', 'a', `a${'b'.repeat(199)}`]) {
      expect(IdempotencyKeySchema.safeParse(key).success, key).toBe(true)
    }
    for (const key of ['_py', '.py', ':py', '-py', '', `a${'b'.repeat(200)}`, 'py 1']) {
      expect(IdempotencyKeySchema.safeParse(key).success, key).toBe(false)
    }
  })
})

describe('the form values', () => {
  it('are a small record of text the platform passes through', () => {
    expect(ProviderFormValuesSchema.safeParse({ secret: 'cs_1', account: 'acct_1' }).success).toBe(
      true,
    )
    expect(ProviderFormValuesSchema.safeParse({ secret: 1 }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v']))
    expect(ProviderFormValuesSchema.safeParse(many).success).toBe(false)
  })
})

describe('the capabilities', () => {
  const fine = {
    holdDays: 7,
    partialCapture: true,
    wallets: ['apple_pay'] as const,
    refundNotices: false,
    minimumMinor: () => 50,
  }

  it('accept a full declaration', () => {
    expect(paymentCapabilitiesProblems(fine)).toEqual([])
  })

  it('refuse a zero hold window, a wallet twice, and a minimum that is not a whole amount', () => {
    expect(paymentCapabilitiesProblems({ ...fine, holdDays: 0 })).not.toEqual([])
    expect(
      paymentCapabilitiesProblems({ ...fine, wallets: ['apple_pay', 'apple_pay'] }),
    ).not.toEqual([])
    expect(paymentCapabilitiesProblems({ ...fine, minimumMinor: () => 0.5 })).not.toEqual([])
  })
})
