// RR-6 fixed; RR-7's block stays `it.fails` until its row (the proxy's settings) is decided. Pure
// logic; no database, no call outside: siteverify is a stub answering what Cloudflare's published
// `1x…AA` test secret answers.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BAD_CODE_LIMITS, BadCodeLimiter, clientNetwork } from '../guard/bad-codes'
import { useTestServerEnvironment } from '../test-database'
import { turnstileCheck } from '../turnstile'

/** Cloudflare's published always-passes test secret (not a secret; see their testing docs). */
const ALWAYS_PASSES = `1x${'0'.repeat(31)}AA`

/** What siteverify answers for that secret, for any token: success, no action or `test`. */
const siteverify = vi.fn(
  async () =>
    new Response(JSON.stringify({ success: true, 'error-codes': [], action: 'test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
) as unknown as typeof fetch

describe('RR-6: the Cloudflare test secret and the environment meaning real money', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('a bot token passes the human check under the test secret (the behaviour itself)', async () => {
    const check = turnstileCheck(ALWAYS_PASSES, siteverify)
    await expect(check('not-a-real-token', 'action-1', 'pay')).resolves.toBe('passed')
  })

  const started = async (environment: Record<string, string>) => {
    useTestServerEnvironment()
    vi.stubEnv('PAYMENTS_ENV', '')
    vi.stubEnv('CI', '')
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
    vi.resetModules()
    const { serverEnv } = await import('../env')
    return serverEnv
  }

  for (const secret of ['1', '2', '3'].map((first) => `${first}x${'0'.repeat(31)}AA`)) {
    it(`production refuses ${secret.slice(0, 2)}…AA when it starts, naming the setting only`, async () => {
      const serverEnv = await started({
        NODE_ENV: 'production',
        PAYMENTS_ENV: 'production',
        TURNSTILE_SECRET_KEY: secret,
      })
      // Compare `checkStripeKey`: "a test key is refused in production".
      expect(() => serverEnv()).toThrow(/TURNSTILE_SECRET_KEY/)
      expect(() => serverEnv()).not.toThrow(secret)
    })
  }

  it('production is read as PAYMENTS_ENV is everywhere else: trimmed, any case', async () => {
    const serverEnv = await started({
      PAYMENTS_ENV: ' Production ',
      TURNSTILE_SECRET_KEY: ALWAYS_PASSES,
    })
    expect(() => serverEnv()).toThrow(/TURNSTILE_SECRET_KEY/)
  })

  it('production starts with a real secret', async () => {
    const serverEnv = await started({
      NODE_ENV: 'production',
      PAYMENTS_ENV: 'production',
      TURNSTILE_SECRET_KEY: '0x4AAAAAAArealLookingSecretKey',
    })
    expect(serverEnv().TURNSTILE_SECRET_KEY).toBe('0x4AAAAAAArealLookingSecretKey')
  })

  // The ones that must keep working: `next dev`, CI, and local e2e's `next start` (NODE_ENV is
  // production there, no CI; playwright.config.ts sets PAYMENTS_ENV=test), and a staging deployment.
  for (const [name, environment] of [
    ['development', { NODE_ENV: 'development', PAYMENTS_ENV: 'development' }],
    ['development with no PAYMENTS_ENV', { NODE_ENV: 'development' }],
    ['CI', { NODE_ENV: 'test', CI: 'true', PAYMENTS_ENV: 'test' }],
    ['local e2e under next start', { NODE_ENV: 'production', PAYMENTS_ENV: 'test' }],
    ['staging', { NODE_ENV: 'production', PAYMENTS_ENV: 'staging' }],
  ] as const) {
    it(`${name} still starts with the test secret`, async () => {
      const serverEnv = await started({ ...environment, TURNSTILE_SECRET_KEY: ALWAYS_PASSES })
      expect(serverEnv().TURNSTILE_SECRET_KEY).toBe(ALWAYS_PASSES)
    })
  }
})

describe('RR-7: the wrong-code limiter and a header the caller chooses', () => {
  const asClient = (address: string, header: string) => new Headers({ [header]: address })

  for (const header of ['cf-connecting-ip', 'x-real-ip']) {
    it.fails(`RR-7: a caller rotating ${header}, direct to the origin, must still be blocked`, () => {
      const limiter = new BadCodeLimiter()
      const verdicts = []
      // One caller, 60 tries, more than the 50 that block. The socket's address is the same each
      // time, and the route has nothing else to go on.
      for (let attempt = 0; attempt < BAD_CODE_LIMITS.blockAfter + 10; attempt++) {
        const network = clientNetwork(asClient(`203.0.113.${attempt}`, header))
        limiter.recordWrong(network)
        verdicts.push(limiter.check(network).kind)
      }
      expect(verdicts).toContain('blocked')
    })
  }

  it('the proxy-appended X-Forwarded-For entry alone does what the limiter wants (control)', () => {
    const limiter = new BadCodeLimiter()
    let last = ''
    for (let attempt = 0; attempt < BAD_CODE_LIMITS.blockAfter + 1; attempt++) {
      const network = clientNetwork(
        new Headers({ 'x-forwarded-for': `10.0.0.${attempt}, 198.51.100.7` }),
      )
      limiter.recordWrong(network)
      last = limiter.check(network).kind
    }
    expect(last).toBe('blocked')
  })
})
