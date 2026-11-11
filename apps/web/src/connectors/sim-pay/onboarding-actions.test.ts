// "Done" on the simulated provider's stand-in page (#398), without a browser: the production guard,
// the strict return addresses, the worker being told, and the trip back to the Paying settings at
// `?connection=return` (or back to the page, with the problem, when the worker refused).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ask = vi.fn()
vi.mock('../../server/payments-connection', () => ({
  askConnection: (...args: unknown[]) => ask(...args),
}))
vi.mock('../../server/reveal', () => ({
  revealConfig: () => ({ url: 'http://worker', token: 't' }),
}))
vi.mock('../../server/settings/scope', () => ({
  inSettingsScope: async (
    _venue: string,
    work: (scope: Record<string, unknown>) => Promise<unknown>,
  ) =>
    work({
      pool: {},
      tenantId: 'tn_1',
      venueId: 'vn_abcdefghij0123456789AB',
      userId: 'u1',
      sessionId: 's1',
      signedInAt: new Date(),
      operator: false,
    }),
}))
vi.mock('../../server/settings/paying-addresses', async (importActual) => ({
  ...(await importActual<typeof import('../../server/settings/paying-addresses')>()),
  payingInstallation: () => ({ base: 'https://restro.test', guestHost: 'restro.test' }),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))

import { finishSimPayFormAction } from './onboarding-actions'

const INVALID = { ok: false, error: 'invalid' }
const done = (data: FormData) => finishSimPayFormAction(null, data)

const VENUE = 'vn_abcdefghij0123456789AB'
const RETURN = `https://restro.test/venues/${VENUE}?tab=settings&section=paying&connection=return`
const REFRESH = `https://restro.test/venues/${VENUE}?tab=settings&section=paying&connection=refresh`

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    ref: 'simacct_abc_1',
    venue: VENUE,
    return: RETURN,
    refresh: REFRESH,
    ...overrides,
  })) {
    data.set(key, value)
  }
  return data
}

describe('Done on the simulated provider’s form', () => {
  beforeEach(() => {
    vi.stubEnv('PAYMENTS_ENV', 'test')
    ask.mockReset()
    ask.mockResolvedValue({ ok: true })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('tells the worker, then goes back to the Paying settings at ?connection=return', async () => {
    await expect(done(form())).rejects.toThrow(`REDIRECT ${RETURN}`)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]?.[2]).toEqual({
      action: 'finish_simulated',
      accountRef: 'simacct_abc_1',
      guestHost: 'restro.test',
    })
    expect(RETURN).toMatch(/connection=return$/)
  })

  it('does not exist in production, nor with no known environment, and never asks the worker', async () => {
    for (const env of ['production', '', 'somewhere']) {
      vi.stubEnv('PAYMENTS_ENV', env)
      expect(await done(form())).toEqual(INVALID)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('sends the owner nowhere but the settings: other return addresses, a made-up account or venue are refused', async () => {
    const bads: Record<string, string>[] = [
      { return: 'https://evil.example/' },
      { refresh: 'https://evil.example/' },
      { return: REFRESH },
      { ref: 'acct_real_1' },
      { venue: 'not-a-venue' },
    ]
    for (const bad of bads) {
      expect(await done(form(bad))).toEqual(INVALID)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('answers with the worker’s refusal for the form to word, and does not leave the page', async () => {
    ask.mockResolvedValue({ ok: false, error: 'not_connecting' })
    expect(await done(form())).toEqual({ ok: false, error: 'not_connecting' })
  })
})
