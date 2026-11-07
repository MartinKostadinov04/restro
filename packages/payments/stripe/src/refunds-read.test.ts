// A payment's refunds, read one by one (#261): GET /v1/refunds?payment_intent=… on the venue's
// account (https://docs.stripe.com/api/refunds/list.md), newest first, and the seam's list oldest
// first. A fake fetch answers, so this needs no recording; the conformance suite's check does the
// same against the sandbox once it is recorded. Only reads: Restro never makes a refund.
import { providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createStripeProvider } from './provider'

const ACCOUNT = providerRef('acct_1Test')
const PAYMENT = providerRef('pi_3Test')

const refund = (id: string, amount: number, status: string | null) => ({
  id,
  object: 'refund',
  amount,
  currency: 'eur',
  payment_intent: 'pi_3Test',
  status,
})

type Asked = { method: string; path: string; query: URLSearchParams; account: string | null }

/** Answers each request with the next of `pages`, as Stripe's list object. */
function providerAnswering(pages: readonly (readonly unknown[])[], hasMore = pages.length > 1) {
  const asked: Asked[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url)
    const headers = new Headers(init?.headers)
    asked.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      account: headers.get('stripe-account'),
    })
    const at = asked.length - 1
    return Response.json(
      {
        object: 'list',
        url: '/v1/refunds',
        data: pages[at] ?? [],
        has_more: at < pages.length - 1 ? hasMore : false,
      },
      { headers: { 'request-id': 'req_test' } },
    )
  }
  return { asked, stripe: createStripeProvider({ env: 'test', key: 'sk_test_fake0', fetch }) }
}

describe("reading a payment's refunds", () => {
  it("lists them oldest first, by their own ids, on the venue's account, with GET only", async () => {
    const { asked, stripe } = providerAnswering([
      [
        refund('re_3', 500, 'succeeded'),
        refund('re_2', 500, 'failed'),
        refund('re_1', 300, 'pending'),
      ],
    ])
    expect(await stripe.readRefunds(ACCOUNT, PAYMENT)).toEqual({
      complete: true,
      value: [
        { ref: providerRef('re_1'), amountMinor: 300, failed: false },
        { ref: providerRef('re_2'), amountMinor: 500, failed: true },
        { ref: providerRef('re_3'), amountMinor: 500, failed: false },
      ],
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ method: 'GET', path: '/v1/refunds', account: 'acct_1Test' })
    expect(asked[0]?.query.get('payment_intent')).toBe('pi_3Test')
    expect(asked[0]?.query.get('limit')).toBe('100')
  }, 60_000)

  it('reads every status Stripe documents, and a cancelled refund as failed', async () => {
    const { stripe } = providerAnswering([
      [
        refund('re_5', 100, 'canceled'),
        refund('re_4', 100, 'failed'),
        refund('re_3', 100, 'succeeded'),
        refund('re_2', 100, 'requires_action'),
        refund('re_1', 100, 'pending'),
      ],
    ])
    const reading = await stripe.readRefunds(ACCOUNT, PAYMENT)
    expect(reading.complete && reading.value.map((r) => r.failed)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ])
  }, 60_000)

  it('follows the pages by the last id of each, and nothing is lost between them', async () => {
    const { asked, stripe } = providerAnswering([
      [refund('re_4', 400, 'succeeded'), refund('re_3', 300, 'succeeded')],
      [refund('re_2', 200, 'succeeded'), refund('re_1', 100, 'failed')],
    ])
    const reading = await stripe.readRefunds(ACCOUNT, PAYMENT)
    expect(reading.complete && reading.value.map((r) => r.ref.provider)).toEqual([
      're_1',
      're_2',
      're_3',
      're_4',
    ])
    expect(asked.map((request) => request.query.get('starting_after'))).toEqual([null, 're_3'])
    expect(asked.every((request) => request.method === 'GET')).toBe(true)
  }, 60_000)

  it('reads an empty list as no refunds', async () => {
    const { stripe } = providerAnswering([[]])
    expect(await stripe.readRefunds(ACCOUNT, PAYMENT)).toEqual({ complete: true, value: [] })
  }, 60_000)

  for (const [name, status] of [
    ['a status Stripe may add later', 'held_back'],
    ['no status', null],
  ] as const) {
    it(`concludes nothing from ${name}`, async () => {
      const { stripe } = providerAnswering([
        [refund('re_2', 500, 'succeeded'), refund('re_1', 500, status)],
      ])
      expect((await stripe.readRefunds(ACCOUNT, PAYMENT)).complete).toBe(false)
    }, 60_000)
  }

  it('concludes nothing from a refund it cannot read, or too many pages', async () => {
    const malformed = providerAnswering([[{ id: 're_1', object: 'refund', status: 'succeeded' }]])
    expect((await malformed.stripe.readRefunds(ACCOUNT, PAYMENT)).complete).toBe(false)

    const many = Array.from({ length: 11 }, (_, page) => [refund(`re_${page}`, 100, 'succeeded')])
    const endless = providerAnswering(many)
    const reading = await endless.stripe.readRefunds(ACCOUNT, PAYMENT)
    expect(reading).toMatchObject({ complete: false, reason: 'too many refunds to list' })
    expect(endless.asked).toHaveLength(10)
  }, 60_000)

  it('concludes nothing from a failure part-way, nor from a payment the account does not have', async () => {
    let calls = 0
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) {
        return Response.json({
          object: 'list',
          url: '/v1/refunds',
          data: [refund('re_2', 100, 'succeeded')],
          has_more: true,
        })
      }
      return Response.json(
        { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such' } },
        { status: 404 },
      )
    }
    const stripe = createStripeProvider({ env: 'test', key: 'sk_test_fake0', fetch })
    expect((await stripe.readRefunds(ACCOUNT, PAYMENT)).complete).toBe(false)
  }, 60_000)
})
