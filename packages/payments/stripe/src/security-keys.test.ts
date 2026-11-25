// What a read makes of a lost key or a lost account (the repair-review's A7, RR-18). A fake fetch
// answers with the errors Stripe's documentation names; nothing calls Stripe.
//   401 for an invalid key: https://docs.stripe.com/error-low-level.md
//   `api_key_expired`, `account_invalid`, `resource_missing`: https://docs.stripe.com/error-codes.md
//   403 for a restricted key without the permission: https://docs.stripe.com/keys/restricted-api-keys.md
// The status of `account_invalid` is not in those pages: the 403 here is an assumption, and either
// status reads the same below. Kept proof of what the provider does: the reading is incomplete, it
// names no lost access (a write would, `classify`), and no key shows in its reason. RR-18's loop
// follows from it; its red test is on or/rr-loops.
import { providerRef } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { createStripeProvider } from './provider'

const ACCOUNT = providerRef('acct_1Test')
const KEY = 'sk_test_fake0'

function providerAnswering(status: number, type: string, code: string, message: string) {
  const fetch: typeof globalThis.fetch = async () =>
    Response.json({ error: { type, code, message } }, { status })
  return createStripeProvider({ env: 'test', key: KEY, fetch })
}

const ERRORS = [
  [401, 'invalid_request_error', 'api_key_expired', `Expired API Key provided: ${KEY}`],
  [401, 'invalid_request_error', 'invalid_api_key', `Invalid API Key provided: ${KEY}`],
  [403, 'invalid_request_error', 'more_permissions_required', 'The key lacks this permission'],
  [403, 'invalid_request_error', 'account_invalid', 'The account is invalid'],
] as const

describe('reading a PaymentIntent with a lost key or a lost account', () => {
  for (const [status, type, code, message] of ERRORS) {
    it(`${status} ${code}: incomplete, not access lost, no key in the reason`, async () => {
      const stripe = providerAnswering(status, type, code, message)
      const reading = await stripe.readNoticeSubject(ACCOUNT, {
        id: 'evt_1',
        type: 'payment_intent.amount_capturable_updated',
        kind: 'payment',
        accountRef: ACCOUNT,
        objectRef: providerRef('pi_3Test'),
      })
      expect(reading.complete).toBe(false)
      if (reading.complete) return
      expect(reading.reason).toContain(code)
      expect(reading.reason).not.toContain(KEY)
    }, 60_000)
  }

  it('a PaymentIntent that is not on this account reads as nothing', async () => {
    const stripe = providerAnswering(
      404,
      'invalid_request_error',
      'resource_missing',
      'No such payment_intent',
    )
    const reading = await stripe.readNoticeSubject(ACCOUNT, {
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      kind: 'payment',
      accountRef: ACCOUNT,
      objectRef: providerRef('pi_3Test'),
    })
    expect(reading).toEqual({ complete: true, value: null })
  }, 60_000)
})
