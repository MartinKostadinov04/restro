// The subject of a guest payment's notice (#110): for `payment_intent.*` the event's object is the
// PaymentIntent itself, read back with its latest charge (https://docs.stripe.com/api/events/types.md).
// A fake fetch answers the one read, so this needs no recording.
import { providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createStripeProvider } from './provider'

const PAYMENT_ID = 'py_0123456789abcdefghijkl'
const ACCOUNT = providerRef('acct_1Test')

function intentAnswer() {
  return {
    id: 'pi_3Test',
    object: 'payment_intent',
    status: 'requires_capture',
    amount: 1050,
    amount_capturable: 1050,
    amount_received: 0,
    currency: 'eur',
    metadata: { restro_payment: PAYMENT_ID },
    last_payment_error: null,
    latest_charge: {
      id: 'ch_3Test',
      object: 'charge',
      payment_intent: 'pi_3Test',
      amount_refunded: 0,
      payment_method_details: {
        card: {
          capture_before: 1_793_000_000,
          authorization_code: '123456',
          three_d_secure: { result: 'authenticated' },
        },
      },
    },
  }
}

function provider() {
  const asked: string[] = []
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url)
    asked.push(url.pathname)
    if (url.pathname === '/v1/payment_intents/pi_3Test') {
      return Response.json(intentAnswer(), { headers: { 'request-id': 'req_test' } })
    }
    return Response.json(
      {
        error: {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: 'No such object',
        },
      },
      { status: 404 },
    )
  }
  return { asked, provider: createStripeProvider({ env: 'test', key: 'sk_test_fake0', fetch }) }
}

describe("a guest payment's notice", () => {
  it('reads the PaymentIntent the event names, and nothing before it', async () => {
    const { asked, provider: stripe } = provider()
    const reading = await stripe.readNoticeSubject(ACCOUNT, {
      id: 'evt_1',
      type: 'payment_intent.amount_capturable_updated',
      kind: 'payment',
      accountRef: ACCOUNT,
      objectRef: providerRef('pi_3Test'),
    })
    expect(asked).toEqual(['/v1/payment_intents/pi_3Test'])
    expect(reading.complete).toBe(true)
    if (!reading.complete) return
    expect(reading.value).toMatchObject({
      ref: { provider: 'pi_3Test' },
      paymentId: PAYMENT_ID,
      status: 'held',
      heldMinor: 1050,
    })
  })

  it('finds nothing for a PaymentIntent that is not on the account', async () => {
    const { provider: stripe } = provider()
    const reading = await stripe.readNoticeSubject(ACCOUNT, {
      id: 'evt_2',
      type: 'payment_intent.payment_failed',
      kind: 'payment',
      accountRef: ACCOUNT,
      objectRef: providerRef('pi_3Other'),
    })
    expect(reading).toEqual({ complete: true, value: null })
  })
})
