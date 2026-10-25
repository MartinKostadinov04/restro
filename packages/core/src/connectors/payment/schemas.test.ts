import { describe, expect, it } from 'vitest'

import { newId } from '../../ids'
import { paymentCapabilitiesProblems } from './capabilities'
import { providerRef } from './provider-ref'
import {
  PAYMENT_ANSWER_SCHEMAS,
  PaymentRefusalSchema,
  ProviderFormValuesSchema,
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
  captureBefore: '2026-11-01T21:00:00.000Z',
  threeDs: 'authenticated',
  authorisationCode: 'A1B2C3',
}

describe('the provider payment', () => {
  it('accepts a payment whose amounts match its status', () => {
    expect(ProviderPaymentSchema.safeParse(held).success).toBe(true)
    const captured = { ...held, status: 'captured', heldMinor: 0, capturedMinor: 2_000 }
    expect(ProviderPaymentSchema.safeParse(captured).success).toBe(true)
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
