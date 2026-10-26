// Turnstile's server check (#76): siteverify gets the secret, the token and the Send's action id as
// its idempotency key, and no IP address; a failed token, no secret or another action's token
// fails; only siteverify itself being down (network, timeout, 5xx, `internal-error`) is
// `unavailable`. #110: a Pay takes only the `pay_start` action, a Send only `order_send`.
import { describe, expect, it, vi } from 'vitest'

import { SITEVERIFY_URL, turnstileCheck } from './turnstile'

const SECRET = 'live-secret-for-a-test'
const TEST_SECRET = '1x0000000000000000000000000000000AA'
const ACTION_ID = '0d6f3c1e-5b8a-4c2e-9f7d-1a2b3c4d5e6f'

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('the Turnstile check', () => {
  it('posts the secret, the token and the action id, and passes a good token for the Send', async () => {
    const fetcher = answer(200, { success: true, 'error-codes': [], action: 'order_send' })
    expect(await turnstileCheck(SECRET, fetcher)('token', ACTION_ID, 'send')).toBe('passed')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(SITEVERIFY_URL)
    const body = new URLSearchParams(String(init.body))
    expect(Object.fromEntries(body)).toEqual({
      secret: SECRET,
      response: 'token',
      idempotency_key: ACTION_ID,
    })
  })

  it('fails closed: no secret, a failed token, another action, a 4xx or a misshapen answer', async () => {
    const never = vi.fn()
    expect(await turnstileCheck(undefined, never)('token', ACTION_ID, 'send')).toBe('failed')
    expect(never).not.toHaveBeenCalled()
    for (const fetcher of [
      answer(200, { success: false, 'error-codes': ['invalid-input-response'] }),
      answer(200, { success: false, 'error-codes': ['timeout-or-duplicate'] }),
      answer(200, { success: true, action: 'login' }),
      answer(200, { success: true, action: 'test' }),
      answer(200, { success: true }),
      answer(400, { success: false }),
      answer(200, 'nonsense'),
    ]) {
      expect(await turnstileCheck(SECRET, fetcher)('token', ACTION_ID, 'send')).toBe('failed')
    }
  })

  it('takes each use’s own action only', async () => {
    const pay = answer(200, { success: true, action: 'pay_start' })
    expect(await turnstileCheck(SECRET, pay)('token', ACTION_ID, 'pay')).toBe('passed')
    expect(await turnstileCheck(SECRET, pay)('token', ACTION_ID, 'send')).toBe('failed')
    const send = answer(200, { success: true, action: 'order_send' })
    expect(await turnstileCheck(SECRET, send)('token', ACTION_ID, 'pay')).toBe('failed')
  })

  it('takes the test secret’s `test` action, or none, and only from a test secret', async () => {
    const fetcher = answer(200, { success: true, action: 'test' })
    expect(await turnstileCheck(TEST_SECRET, fetcher)('token', ACTION_ID, 'send')).toBe('passed')
    // What the `1x…AA` secret answers for the dummy token: no action at all.
    const none = answer(200, { success: true, 'error-codes': [] })
    expect(await turnstileCheck(TEST_SECRET, none)('token', ACTION_ID, 'pay')).toBe('passed')
    expect(await turnstileCheck(SECRET, none)('token', ACTION_ID, 'pay')).toBe('failed')
    // The test secret's answer for the dummy token, with its hostname (#77).
    const named = answer(200, { success: true, 'error-codes': [], hostname: 'example.com' })
    expect(await turnstileCheck(TEST_SECRET, named)('token', ACTION_ID, 'send')).toBe('passed')
  })

  it('is unavailable only when siteverify is down', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await turnstileCheck(SECRET, down)('token', ACTION_ID, 'send')).toBe('unavailable')
    expect(await turnstileCheck(SECRET, answer(503, {}))('token', ACTION_ID, 'send')).toBe(
      'unavailable',
    )
    const internal = answer(200, { success: false, 'error-codes': ['internal-error'] })
    expect(await turnstileCheck(SECRET, internal)('token', ACTION_ID, 'send')).toBe('unavailable')
  })
})
