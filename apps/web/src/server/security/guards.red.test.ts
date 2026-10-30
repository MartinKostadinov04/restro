// RED by design (the repair-review's A7, RR-6 and RR-7). Pure logic; no database, no call outside:
// siteverify is a stub answering what Cloudflare's published `1x…AA` test secret answers.
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

describe('RR-6: Cloudflare test secret outside development and CI', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('a bot token passes the human check under the test secret (the behaviour itself)', async () => {
    const check = turnstileCheck(ALWAYS_PASSES, siteverify)
    await expect(check('not-a-real-token', 'action-1', 'pay')).resolves.toBe('passed')
  })

  it('the production environment must refuse the test secret when it starts', async () => {
    useTestServerEnvironment()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAYMENTS_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', ALWAYS_PASSES)
    vi.resetModules()
    const { serverEnv } = await import('../env')
    // Compare `checkStripeKey`: "a test key is refused in production".
    expect(() => serverEnv()).toThrow(/TURNSTILE_SECRET_KEY/)
  })
})

describe('RR-7: the wrong-code limiter and a header the caller chooses', () => {
  const asClient = (address: string, header: string) => new Headers({ [header]: address })

  for (const header of ['cf-connecting-ip', 'x-real-ip']) {
    it(`a caller rotating ${header}, direct to the origin, must still be blocked`, () => {
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
