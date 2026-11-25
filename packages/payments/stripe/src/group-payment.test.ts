// A group payment on Stripe (#543; D160 §3): several guests share one bill by amount, and each
// guest's card is its own hold, a manual-capture PaymentIntent on the venue's account (direct
// charge, `Stripe-Account`) made under its own idempotency key and carrying the hold's id beside the
// payment's (`restro_hold`, `restro_payment`). Each is captured or cancelled one by one, and a
// write whose answer was lost is read back, by its hold or its ref, before the same key repeats it
// (D125 3.9).
//
// A small in-memory stand-in for Stripe's PaymentIntents API answers, so this needs no recording
// and no network; the conformance suite's group check (`groupHoldsCheck`) does the same against
// the sandbox once it is recorded. The stand-in keeps only what Stripe documents and this package
// relies on:
//   - a key reused with the same parameters answers the first answer again; with others, a 400
//     `idempotency_error` (https://docs.stripe.com/api/idempotent_requests.md);
//   - an intent lives on one account; another account's request reads `resource_missing`
//     (https://docs.stripe.com/connect/authentication.md);
//   - capture takes `amount_to_capture` of a `requires_capture` intent and cancel ends one; any
//     other state is a 400 `payment_intent_unexpected_state` with the intent
//     (https://docs.stripe.com/api/payment_intents/capture.md, .../cancel.md, error-codes.md);
//   - search takes `metadata['key']:'value'` clauses joined by `AND`
//     (https://docs.stripe.com/search.md).
// The lost answers come from the conformance harness's own faults (`testing/test-faults.ts`).

import { newId, type PaymentHoldId, type ProviderRef, providerRef } from '@restro/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { HOLD_METADATA_KEY, PAYMENT_METADATA_KEY } from './mapping'
import { createStripeProvider } from './provider'
import { StripeFaults } from './testing/test-faults'

const VENUE = providerRef('acct_1Venue')
const OTHER_VENUE = providerRef('acct_1Other')
const NOW_S = 1_793_000_000

interface FakeIntent {
  id: string
  account: string
  status: string
  amount: number
  amount_capturable: number
  amount_received: number
  capture_method: string
  metadata: Record<string, string>
  created: number
  charge: Record<string, unknown> | null
}

interface Asked {
  readonly method: string
  readonly path: string
  readonly account: string | null
  readonly key: string | null
  readonly body: URLSearchParams
  readonly query: URLSearchParams
}

/** Stripe's PaymentIntents, in memory, per account, with its idempotency store. */
class FakeStripe {
  readonly intents = new Map<string, FakeIntent>()
  readonly asked: Asked[] = []
  /** Each capture that took money: the intent and the amount. */
  readonly captures: { intent: string; amount: number }[] = []
  readonly #stored = new Map<string, { params: string; status: number; body: unknown }>()
  #counter = 0

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    const asked: Asked = {
      method,
      path: url.pathname,
      account: headers.get('stripe-account'),
      key: headers.get('idempotency-key'),
      body,
      query: url.searchParams,
    }
    this.asked.push(asked)
    if (method === 'POST' && asked.key !== null) {
      const storeKey = `${asked.account ?? '-'}|${asked.key}`
      const params = `${asked.path}?${body.toString()}`
      const stored = this.#stored.get(storeKey)
      if (stored !== undefined) {
        if (stored.params !== params) {
          return error(400, 'idempotency_error', undefined, 'Keys for idempotent requests…')
        }
        return Response.json(stored.body, {
          status: stored.status,
          headers: { 'idempotent-replayed': 'true' },
        })
      }
      const answer = this.#answer(asked)
      this.#stored.set(storeKey, {
        params,
        status: answer.status,
        body: await answer.clone().json(),
      })
      return answer
    }
    return this.#answer(asked)
  }

  /** The guest's card holds the intent (the card form, Stripe.js: not this package's). */
  guestPays(paymentRef: ProviderRef): void {
    const intent = this.intents.get(paymentRef.provider)
    if (intent === undefined) throw new Error(`no intent ${paymentRef.provider}`)
    intent.status = 'requires_capture'
    intent.amount_capturable = intent.amount
    intent.charge = {
      id: `ch_${intent.id}`,
      object: 'charge',
      payment_intent: intent.id,
      amount_refunded: 0,
      payment_method_details: {
        card: {
          capture_before: NOW_S + 7 * 86_400,
          authorization_code: '123456',
          three_d_secure: { result: 'authenticated' },
        },
      },
    }
  }

  #answer(asked: Asked): Response {
    const { method, path, body, query } = asked
    const account = asked.account ?? ''
    if (method === 'POST' && path === '/v1/payment_intents') {
      this.#counter += 1
      const metadata: Record<string, string> = {}
      for (const [name, value] of body) {
        const key = /^metadata\[(.+)\]$/.exec(name)?.[1]
        if (key !== undefined) metadata[key] = value
      }
      const intent: FakeIntent = {
        id: `pi_${this.#counter}`,
        account,
        status: 'requires_payment_method',
        amount: Number(body.get('amount')),
        amount_capturable: 0,
        amount_received: 0,
        capture_method: body.get('capture_method') ?? 'automatic',
        metadata,
        created: NOW_S + this.#counter,
        charge: null,
      }
      this.intents.set(intent.id, intent)
      return Response.json(view(intent))
    }
    if (method === 'GET' && path === '/v1/payment_intents') {
      const data = [...this.intents.values()]
        .filter((intent) => intent.account === account)
        .sort((a, b) => b.created - a.created)
        .map(view)
      return Response.json({ object: 'list', url: path, data, has_more: false })
    }
    if (method === 'GET' && path === '/v1/payment_intents/search') {
      const clauses = (query.get('query') ?? '').split(' AND ').map((clause) => {
        const match = /^metadata\['([^']+)'\]:'([^']+)'$/.exec(clause)
        if (match === null) throw new Error(`the stand-in cannot search ${clause}`)
        return { key: match[1] as string, value: match[2] as string }
      })
      const data = [...this.intents.values()]
        .filter(
          (intent) =>
            intent.account === account &&
            clauses.every((clause) => intent.metadata[clause.key] === clause.value),
        )
        .map(view)
      return Response.json({ object: 'search_result', url: path, data, has_more: false })
    }
    if (method === 'GET' && path === '/v1/disputes') {
      return Response.json({ object: 'list', url: path, data: [], has_more: false })
    }
    const step = /^\/v1\/payment_intents\/([^/]+)(?:\/(capture|cancel))?$/.exec(path)
    const intent = step === null ? undefined : this.intents.get(step[1] as string)
    if (step === null || intent === undefined || intent.account !== account) {
      return error(404, 'invalid_request_error', 'resource_missing', 'No such payment_intent')
    }
    if (method === 'GET' && step[2] === undefined) return Response.json(view(intent))
    if (method === 'POST' && step[2] === 'capture') {
      if (intent.status !== 'requires_capture') {
        return error(400, 'invalid_request_error', 'payment_intent_unexpected_state', '', intent)
      }
      const amount = Number(body.get('amount_to_capture') ?? intent.amount_capturable)
      if (amount > intent.amount_capturable) {
        return error(400, 'invalid_request_error', 'amount_too_large', '', intent)
      }
      intent.status = 'succeeded'
      intent.amount_received = amount
      intent.amount_capturable = 0
      this.captures.push({ intent: intent.id, amount })
      return Response.json(view(intent))
    }
    if (method === 'POST' && step[2] === 'cancel') {
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        return error(400, 'invalid_request_error', 'payment_intent_unexpected_state', '', intent)
      }
      intent.status = 'canceled'
      intent.amount_capturable = 0
      return Response.json(view(intent))
    }
    throw new Error(`the stand-in has no ${method} ${path}`)
  }
}

/** The intent as Stripe answers it, with its latest charge expanded. */
function view(intent: FakeIntent) {
  return {
    id: intent.id,
    object: 'payment_intent',
    status: intent.status,
    amount: intent.amount,
    amount_capturable: intent.amount_capturable,
    amount_received: intent.amount_received,
    capture_method: intent.capture_method,
    currency: 'eur',
    created: intent.created,
    metadata: { ...intent.metadata },
    client_secret: `${intent.id}_secret_test`,
    last_payment_error: null,
    cancellation_reason: intent.status === 'canceled' ? 'requested_by_customer' : null,
    latest_charge: intent.charge,
  }
}

function error(
  status: number,
  type: string,
  code: string | undefined,
  message: string,
  intent?: FakeIntent,
): Response {
  return Response.json(
    {
      error: {
        type,
        ...(code === undefined ? {} : { code }),
        message,
        ...(intent === undefined ? {} : { payment_intent: view(intent) }),
      },
    },
    { status },
  )
}

let stripe: FakeStripe
let faults: StripeFaults
let provider: ReturnType<typeof createStripeProvider>

beforeEach(() => {
  stripe = new FakeStripe()
  faults = new StripeFaults()
  provider = createStripeProvider({
    env: 'test',
    key: 'sk_test_fake0',
    fetch: faults.wrap(stripe.fetch),
    now: () => new Date(NOW_S * 1000),
  })
})

const paymentId = newId('py')

/** One guest's hold of the group, made under its own key. */
async function hold(amountMinor: number, holdId: PaymentHoldId = newId('ph')) {
  const outcome = await provider.createHold({
    paymentId,
    holdId,
    accountRef: VENUE,
    amountMinor,
    currency: 'EUR',
    idempotencyKey: `${holdId}:hold`,
    description: 'Test Bar, tables 4 and 5',
  })
  return { holdId, amountMinor, outcome }
}

async function heldGroup(amounts: readonly number[]) {
  const holds = []
  for (const amountMinor of amounts) {
    const made = await hold(amountMinor)
    if (made.outcome.kind !== 'done') throw new Error(`createHold answered ${made.outcome.kind}`)
    stripe.guestPays(made.outcome.result.paymentRef)
    holds.push({ ...made, paymentRef: made.outcome.result.paymentRef })
  }
  return holds as [(typeof holds)[number], ...(typeof holds)[number][]]
}

const posts = (path: RegExp) =>
  stripe.asked.filter((asked) => asked.method === 'POST' && path.test(asked.path))

describe('a group payment on Stripe (#543)', () => {
  it("makes each hold its own manual-capture intent on the venue's account, under its own key", async () => {
    const holds = await heldGroup([1_200, 800, 1_500])
    const creates = posts(/^\/v1\/payment_intents$/)
    expect(creates).toHaveLength(3)
    for (const [index, made] of holds.entries()) {
      const asked = creates[index]
      expect(asked?.account).toBe(VENUE.provider)
      expect(asked?.key).toBe(`${made.holdId}:hold`)
      expect(asked?.body.get('capture_method')).toBe('manual')
      expect(asked?.body.get('amount')).toBe(String(made.amountMinor))
      expect(asked?.body.get(`metadata[${PAYMENT_METADATA_KEY}]`)).toBe(paymentId)
      expect(asked?.body.get(`metadata[${HOLD_METADATA_KEY}]`)).toBe(made.holdId)
    }
    expect(new Set(holds.map((made) => made.paymentRef.provider)).size).toBe(3)
    expect(stripe.captures).toEqual([])
  })

  it('finds each hold by its hold, carrying it, and nothing by an unknown one', async () => {
    const holds = await heldGroup([1_200, 800])
    for (const made of holds) {
      expect(await provider.findByPaymentId(VENUE, paymentId, made.holdId)).toEqual({
        complete: true,
        value: expect.objectContaining({
          ref: made.paymentRef,
          paymentId,
          holdId: made.holdId,
          status: 'held',
          heldMinor: made.amountMinor,
        }),
      })
    }
    const searches = stripe.asked.filter((asked) => asked.path === '/v1/payment_intents/search')
    expect(searches.at(-1)?.query.get('query')).toBe(
      `metadata['${PAYMENT_METADATA_KEY}']:'${paymentId}' AND metadata['${HOLD_METADATA_KEY}']:'${holds[1]?.holdId}'`,
    )
    expect(await provider.findByPaymentId(VENUE, paymentId, newId('ph'))).toEqual({
      complete: true,
      value: null,
    })
    // Another venue's account has none of them.
    expect(await provider.findByPaymentId(OTHER_VENUE, paymentId, holds[0].holdId)).toEqual({
      complete: true,
      value: null,
    })
  })

  it("concludes nothing from the payment's id alone, even with one hold", async () => {
    await heldGroup([1_200])
    expect((await provider.findByPaymentId(VENUE, paymentId)).complete).toBe(false)
    await heldGroup([800])
    expect((await provider.findByPaymentId(VENUE, paymentId)).complete).toBe(false)
  })

  it('still finds an ordinary payment by its id alone, with no hold', async () => {
    const ordinary = newId('py')
    const made = await provider.createHold({
      paymentId: ordinary,
      accountRef: VENUE,
      amountMinor: 1_200,
      currency: 'EUR',
      idempotencyKey: `${ordinary}:hold`,
      description: 'Test Bar, table 4',
    })
    expect(posts(/^\/v1\/payment_intents$/)[0]?.body.has(`metadata[${HOLD_METADATA_KEY}]`)).toBe(
      false,
    )
    const found = await provider.findByPaymentId(VENUE, ordinary)
    expect(found).toMatchObject({ complete: true, value: { paymentId: ordinary } })
    expect(found.complete && found.value !== null && 'holdId' in found.value).toBe(false)
    expect(made.kind).toBe('done')
  })

  it('captures and cancels the holds one by one, each under its own key', async () => {
    const [first, second, third] = await heldGroup([1_200, 800, 1_500])
    if (second === undefined || third === undefined) throw new Error('three holds')

    const captured = await provider.capture({
      accountRef: VENUE,
      paymentRef: first.paymentRef,
      amountMinor: first.amountMinor,
      idempotencyKey: `${first.holdId}:capture`,
    })
    expect(captured).toMatchObject({
      kind: 'done',
      result: { status: 'captured', capturedMinor: 1_200, holdId: first.holdId },
    })
    // One hold's capture leaves the others held.
    for (const other of [second, third]) {
      expect(await provider.readPayment(VENUE, other.paymentRef)).toMatchObject({
        value: { status: 'held', heldMinor: other.amountMinor },
      })
    }
    expect(
      await provider.release({
        accountRef: VENUE,
        paymentRef: second.paymentRef,
        idempotencyKey: `${second.holdId}:release`,
      }),
    ).toMatchObject({ kind: 'done', result: { status: 'released', heldMinor: 0 } })
    expect(
      await provider.capture({
        accountRef: VENUE,
        paymentRef: third.paymentRef,
        amountMinor: third.amountMinor,
        idempotencyKey: `${third.holdId}:capture`,
      }),
    ).toMatchObject({ kind: 'done', result: { status: 'captured', capturedMinor: 1_500 } })

    expect(
      posts(/\/(capture|cancel)$/).map((asked) => [asked.path, asked.key, asked.account]),
    ).toEqual([
      [
        `/v1/payment_intents/${first.paymentRef.provider}/capture`,
        `${first.holdId}:capture`,
        VENUE.provider,
      ],
      [
        `/v1/payment_intents/${second.paymentRef.provider}/cancel`,
        `${second.holdId}:release`,
        VENUE.provider,
      ],
      [
        `/v1/payment_intents/${third.paymentRef.provider}/capture`,
        `${third.holdId}:capture`,
        VENUE.provider,
      ],
    ])
    expect(stripe.captures).toEqual([
      { intent: first.paymentRef.provider, amount: 1_200 },
      { intent: third.paymentRef.provider, amount: 1_500 },
    ])
  })

  it('reads a hold whose create answer was lost back by its hold before the key repeats it', async () => {
    await heldGroup([1_200])
    const holdId = newId('ph')
    faults.arm('createHold', 'land_then_timeout')
    expect((await hold(900, holdId)).outcome.kind).toBe('unknown')
    const found = await provider.findByPaymentId(VENUE, paymentId, holdId)
    if (!found.complete || found.value === null) throw new Error('the landed hold is not found')
    expect(found.value).toMatchObject({ holdId, status: 'awaiting_guest', amountMinor: 900 })
    const again = await hold(900, holdId)
    expect(again.outcome).toMatchObject({ kind: 'done', result: { paymentRef: found.value.ref } })
    expect(stripe.intents.size).toBe(2)
  })

  it('reads a hold whose create never landed as none, and the retry makes it once', async () => {
    const holdId = newId('ph')
    faults.arm('createHold', 'timeout_before')
    expect((await hold(900, holdId)).outcome.kind).toBe('unknown')
    expect(await provider.findByPaymentId(VENUE, paymentId, holdId)).toEqual({
      complete: true,
      value: null,
    })
    expect((await hold(900, holdId)).outcome.kind).toBe('done')
    expect((await hold(900, holdId)).outcome.kind).toBe('done')
    expect(stripe.intents.size).toBe(1)
  })

  it('reads a capture whose answer was lost back before the key repeats it, and takes the money once', async () => {
    const [first, second] = await heldGroup([1_200, 800])
    if (second === undefined) throw new Error('two holds')
    const request = {
      accountRef: VENUE,
      paymentRef: second.paymentRef,
      amountMinor: second.amountMinor,
      idempotencyKey: `${second.holdId}:capture`,
    }
    faults.arm('capture', 'land_then_timeout')
    expect((await provider.capture(request)).kind).toBe('unknown')
    expect(await provider.findByPaymentId(VENUE, paymentId, second.holdId)).toMatchObject({
      value: { status: 'captured', capturedMinor: 800 },
    })
    expect(await provider.capture(request)).toMatchObject({
      kind: 'done',
      result: { status: 'captured', capturedMinor: 800 },
    })
    expect(stripe.captures).toEqual([{ intent: second.paymentRef.provider, amount: 800 }])
    // The other guest's hold is still held.
    expect(await provider.readPayment(VENUE, first.paymentRef)).toMatchObject({
      value: { status: 'held' },
    })
  })

  it('reads a cancel whose answer was lost back before the key repeats it', async () => {
    const [first] = await heldGroup([1_200])
    const request = {
      accountRef: VENUE,
      paymentRef: first.paymentRef,
      idempotencyKey: `${first.holdId}:release`,
    }
    faults.arm('release', 'land_then_timeout')
    expect((await provider.release(request)).kind).toBe('unknown')
    expect(await provider.findByPaymentId(VENUE, paymentId, first.holdId)).toMatchObject({
      value: { status: 'released' },
    })
    expect(await provider.release(request)).toMatchObject({
      kind: 'done',
      result: { status: 'released' },
    })
    expect(stripe.captures).toEqual([])
  })

  it("refuses one hold's key for another hold", async () => {
    const made = await hold(1_200)
    const other = await provider.createHold({
      paymentId,
      holdId: newId('ph'),
      accountRef: VENUE,
      amountMinor: 1_200,
      currency: 'EUR',
      idempotencyKey: `${made.holdId}:hold`,
      description: 'Test Bar, tables 4 and 5',
    })
    expect(other).toMatchObject({ kind: 'refused', refusal: { code: 'key_reused' } })
    expect(stripe.intents.size).toBe(1)
  })
})
