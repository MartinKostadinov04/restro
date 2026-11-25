// The web app's call to the worker's payment connection endpoint (#109): what it sends (the
// signed-in person and their session, never a provider key), what it gives back to the browser
// (the provider's hosted address and the account's state, nothing else), and that a refusal, a
// worker that is not there and a failure come back as plain codes without the link in any log.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { askConnection } from './payments-connection'

const config = { url: 'http://worker.railway.internal:8081/', token: 'service-token' }
const target = {
  tenantId: 'tn_a',
  venueId: 'vn_b',
  actor: { userId: 'user-1', sessionId: 'sess-1', signedInAt: new Date('2026-10-27T10:00:00Z') },
}
const START = {
  action: 'start',
  returnUrl: 'https://restro.test/venues/vn_b?tab=settings&section=paying&connection=return',
  refreshUrl: 'https://restro.test/venues/vn_b?tab=settings&section=paying&connection=refresh',
  guestHost: 'guest.restro.test',
} as const

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

describe('askConnection', () => {
  it('sends the person, their session and sign-in with the service token, and returns only the link', async () => {
    const fetcher = reply(200, {
      status: 'accepted',
      url: 'https://connect.example.test/onboard/xyz',
      // Anything else the worker added is dropped here.
      accountRef: 'acct_secret',
    })
    const answer = await askConnection(config, target, START, fetcher as unknown as typeof fetch)
    expect(answer).toEqual({ ok: true, url: 'https://connect.example.test/onboard/xyz' })

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://worker.railway.internal:8081/internal/payments/connection')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer service-token')
    expect(JSON.parse(init.body as string)).toEqual({
      tenantId: 'tn_a',
      venueId: 'vn_b',
      actor: { kind: 'user', userId: 'user-1', sessionId: 'sess-1' },
      signedInAt: '2026-10-27T10:00:00.000Z',
      ...START,
    })
  })

  it('asks as Restro’s admin team when the person is an operator, and returns the state of a return', async () => {
    const fetcher = reply(200, { status: 'accepted', state: 'connected' })
    const answer = await askConnection(
      config,
      { ...target, actor: { ...target.actor, operator: true } },
      { action: 'return', guestHost: 'guest.restro.test' },
      fetcher as unknown as typeof fetch,
    )
    expect(answer).toEqual({ ok: true, state: 'connected' })
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).actor).toEqual({ kind: 'operator', userId: 'user-1' })
  })

  it('answers the worker’s refusal as its code', async () => {
    for (const code of ['permission_denied', 'sign_in_again', 'payment_in_flight']) {
      const fetcher = reply(403, { status: 'refused', code })
      expect(
        await askConnection(config, target, START, fetcher as unknown as typeof fetch),
      ).toEqual({ ok: false, error: code })
    }
  })

  it('says payments are off when the worker has no endpoint or no address is set', async () => {
    expect(
      await askConnection(config, target, START, reply(404, {}) as unknown as typeof fetch),
    ).toEqual({ ok: false, error: 'payments_off' })
    const fetcher = vi.fn()
    expect(
      await askConnection({ url: undefined, token: undefined }, target, START, fetcher),
    ).toEqual({ ok: false, error: 'payments_off' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('answers a failure plainly and never logs the request or the link', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED https://connect.example.test/onboard/secret-link')
    })
    expect(await askConnection(config, target, START, boom as unknown as typeof fetch)).toEqual({
      ok: false,
      error: 'connection_failed',
    })
    expect(
      await askConnection(config, target, START, reply(500, {}) as unknown as typeof fetch),
    ).toEqual({ ok: false, error: 'connection_failed' })
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('secret-link')
    expect(logged).not.toContain('service-token')
  })
})
