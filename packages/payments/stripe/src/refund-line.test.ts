// The one refund Restro makes (`refundLine`, the 11-18 refund decision, 148) on Stripe, with a fake
// fetch (no key, no network, nothing recorded): the payment is read with the platform's key, the
// refund is made with the refund-only key alone, on the venue's account, by the refund row's id as
// the idempotency key and stamped with it; a payment Restro did not make, one not captured, an amount
// above what is left, and a missing refund key all refuse before any refund request; Stripe's own
// refusals and timeouts read as refused and unknown.
import { idSchema, newId, providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { checkStripeRefundKey, StripeConfigError } from './config'
import { createStripeProvider } from './provider'

const ACCOUNT = providerRef('acct_1Test')
const PAYMENT = providerRef('pi_3Test')
const PLATFORM_KEY = 'sk_test_platform0'
const REFUND_KEY = 'rk_test_refund0'

const paymentId = newId('py')
const refundId = newId('rf')

interface Asked {
  readonly method: string
  readonly path: string
  readonly auth: string | null
  readonly account: string | null
  readonly idempotency: string | null
  readonly body: URLSearchParams
}

interface Scenario {
  readonly status?: string
  readonly metadata?: Record<string, string> | null
  readonly amount?: number
  readonly received?: number
  readonly amountRefunded?: number
  /** What POST /v1/refunds answers: a refund object, or `{ status, error }`. */
  readonly refund?: unknown
  readonly throws?: boolean
}

function fakeStripe(scenario: Scenario = {}, options: { refundKey?: string | null } = {}) {
  const asked: Asked[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url)
    const headers = new Headers(init?.headers)
    asked.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      auth: headers.get('authorization'),
      account: headers.get('stripe-account'),
      idempotency: headers.get('idempotency-key'),
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    })
    if (url.pathname === '/v1/refunds' && init?.method === 'POST') {
      if (scenario.throws === true) throw new TypeError('network down')
      const answer = scenario.refund as { status?: number; error?: unknown } | undefined
      if (answer?.error !== undefined) {
        return Response.json({ error: answer.error }, { status: answer.status ?? 400 })
      }
      return Response.json(
        answer ?? {
          id: 're_line1',
          object: 'refund',
          amount: 600,
          status: 'succeeded',
          payment_intent: 'pi_3Test',
          metadata: { restro_refund: refundId },
        },
      )
    }
    if (url.pathname === '/v1/payment_intents/pi_3Test') {
      return Response.json({
        id: 'pi_3Test',
        object: 'payment_intent',
        status: scenario.status ?? 'succeeded',
        amount: scenario.amount ?? 2_000,
        amount_capturable: scenario.status === 'requires_capture' ? (scenario.amount ?? 2_000) : 0,
        amount_received:
          (scenario.status ?? 'succeeded') === 'succeeded'
            ? (scenario.received ?? scenario.amount ?? 2_000)
            : 0,
        currency: 'eur',
        metadata:
          scenario.metadata === null
            ? {}
            : (scenario.metadata ?? { restro_payment: paymentId }),
        latest_charge: {
          id: 'ch_3Test',
          object: 'charge',
          payment_intent: 'pi_3Test',
          amount_refunded: scenario.amountRefunded ?? 0,
        },
      })
    }
    if (url.pathname === '/v1/disputes') {
      return Response.json({ object: 'list', data: [], has_more: false })
    }
    return Response.json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, { status: 404 })
  }
  const refundKey = options.refundKey === undefined ? REFUND_KEY : options.refundKey
  const stripe = createStripeProvider({
    env: 'test',
    key: PLATFORM_KEY,
    ...(refundKey === null ? {} : { refundKey }),
    fetch,
  })
  return { asked, stripe }
}

const request = (amountMinor = 600, id = refundId) => ({
  accountRef: ACCOUNT,
  paymentRef: PAYMENT,
  paymentId,
  refundId: idSchema('rf').parse(id),
  amountMinor,
  idempotencyKey: id,
})

const refundRequests = (asked: readonly Asked[]) =>
  asked.filter((call) => call.path === '/v1/refunds')

describe('refundLine', () => {
  it('refunds a part of a captured payment of ours once, with the refund key, on the venue’s account', async () => {
    const { asked, stripe } = fakeStripe()
    expect(stripe.capabilities.lineRefund).toBe(true)
    const answer = await stripe.refundLine(request())
    expect(answer).toEqual({
      kind: 'done',
      result: {
        ref: providerRef('re_line1'),
        amountMinor: 600,
        failed: false,
        restroRefundId: refundId,
      },
    })
    const made = refundRequests(asked)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({
      method: 'POST',
      account: 'acct_1Test',
      // The refund row's id is the idempotency key, so a retry cannot pay twice.
      idempotency: refundId,
      auth: `Bearer ${REFUND_KEY}`,
    })
    expect(made[0]?.body.get('payment_intent')).toBe('pi_3Test')
    expect(made[0]?.body.get('amount')).toBe('600')
    // Stamped with our refund row, so a refund with no row of ours can be told from the venue's.
    expect(made[0]?.body.get('metadata[restro_refund]')).toBe(refundId)
  })

  it('uses the platform’s key for every read, and the refund key for the refund alone', async () => {
    const { asked, stripe } = fakeStripe()
    await stripe.refundLine(request())
    for (const call of asked) {
      expect(call.auth, `${call.method} ${call.path}`).toBe(
        call.path === '/v1/refunds' ? `Bearer ${REFUND_KEY}` : `Bearer ${PLATFORM_KEY}`,
      )
    }
  })

  it('offers nothing without a refund key: declared off, refused, and no request at all', async () => {
    const { asked, stripe } = fakeStripe({}, { refundKey: null })
    expect(stripe.capabilities.lineRefund).toBe(false)
    expect(await stripe.refundLine(request())).toMatchObject({
      kind: 'refused',
      refusal: { code: 'not_supported' },
    })
    expect(asked).toEqual([])
  })

  it('refuses a payment that is not captured, one Restro did not make, and one named another id', async () => {
    for (const scenario of [
      { status: 'requires_capture' },
      { status: 'canceled' },
      { metadata: null },
      { metadata: { restro_payment: newId('py') } },
    ] satisfies Scenario[]) {
      const { asked, stripe } = fakeStripe(scenario)
      expect(await stripe.refundLine(request()), JSON.stringify(scenario)).toMatchObject({
        kind: 'refused',
        refusal: { code: 'not_eligible' },
      })
      expect(refundRequests(asked), JSON.stringify(scenario)).toEqual([])
    }
  })

  it('refuses more than is left of the payment, before any refund request', async () => {
    const { asked, stripe } = fakeStripe({ amount: 2_000, amountRefunded: 1_500 })
    expect(await stripe.refundLine(request(600))).toMatchObject({
      kind: 'refused',
      refusal: { code: 'amount_above_remaining' },
    })
    expect(refundRequests(asked)).toEqual([])
    // exactly what is left goes through
    const ok = fakeStripe({ amount: 2_000, amountRefunded: 1_500 })
    expect(await ok.stripe.refundLine(request(500))).toMatchObject({ kind: 'done' })
  })

  it('reads Stripe’s own refusals as refused and a lost answer as unknown, never as done', async () => {
    const tooLarge = fakeStripe({
      refund: { status: 400, error: { type: 'invalid_request_error', code: 'amount_too_large' } },
    })
    expect(await tooLarge.stripe.refundLine(request())).toMatchObject({
      kind: 'refused',
      refusal: { code: 'amount_above_remaining' },
    })
    const lost = fakeStripe({ throws: true })
    expect(await lost.stripe.refundLine(request())).toMatchObject({ kind: 'unknown' })
    const server = fakeStripe({
      refund: { status: 500, error: { type: 'api_error', message: 'try again' } },
    })
    expect(await server.stripe.refundLine(request())).toMatchObject({ kind: 'unknown' })
  })

  it('answers a refund that is still pending as made, and one Stripe failed as failed', async () => {
    const pending = fakeStripe({
      refund: { id: 're_p', object: 'refund', amount: 600, status: 'pending', metadata: {} },
    })
    expect(await pending.stripe.refundLine(request())).toMatchObject({
      kind: 'done',
      result: { failed: false },
    })
    const failed = fakeStripe({
      refund: { id: 're_f', object: 'refund', amount: 600, status: 'failed', metadata: {} },
    })
    expect(await failed.stripe.refundLine(request())).toMatchObject({
      kind: 'done',
      result: { failed: true },
    })
  })

  it('never carries a key in a refusal or a reason', async () => {
    const { stripe } = fakeStripe({
      refund: {
        status: 403,
        error: {
          type: 'invalid_request_error',
          code: 'api_key_expired',
          message: `Expired API Key provided: ${REFUND_KEY}`,
        },
      },
    })
    const answer = await stripe.refundLine(request())
    expect(JSON.stringify(answer)).not.toContain(REFUND_KEY)
    expect(JSON.stringify(answer)).not.toContain(PLATFORM_KEY)
  })
})

describe('the refund key', () => {
  it('must be a restricted key, a different one from the platform’s, and fit the environment', () => {
    expect(checkStripeRefundKey('test', REFUND_KEY, PLATFORM_KEY)).toBe(REFUND_KEY)
    expect(() => checkStripeRefundKey('test', 'sk_test_other0', PLATFORM_KEY)).toThrow(
      StripeConfigError,
    )
    expect(() => checkStripeRefundKey('test', 'rk_test_same0', 'rk_test_same0')).toThrow(
      StripeConfigError,
    )
    expect(() => checkStripeRefundKey('production', 'rk_test_refund0', 'rk_live_main0')).toThrow(
      StripeConfigError,
    )
    expect(() => checkStripeRefundKey('test', 'rk_live_refund0', PLATFORM_KEY)).toThrow(
      StripeConfigError,
    )
  })

  it('stops the provider at build when it is wrong, without naming the key', () => {
    let message = ''
    try {
      createStripeProvider({ env: 'test', key: PLATFORM_KEY, refundKey: 'sk_test_secret0' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toBe('')
    expect(message).not.toContain('sk_test_secret0')
  })
})
