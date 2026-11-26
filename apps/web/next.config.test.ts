import { buildCustomRoute } from 'next/dist/lib/build-custom-route'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { frameHeaders } from './src/frame-headers'
import { GUEST_PAGE_SOURCES, guestContentSecurityPolicy, guestHeaders } from './src/guest/headers'

// The real headers on a running server are checked by e2e/guest.spec.ts. This reads the config
// itself: the rule has to be wired in, not just defined.
describe('the guest pages send no referrer (A5-F5)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defines Referrer-Policy: no-referrer for the menu, the table address and the booking page', () => {
    expect(GUEST_PAGE_SOURCES).toEqual(['/m/:path*', '/t/:path*', '/book/:path*'])
    for (const rule of guestHeaders()) {
      expect(rule.headers[0]).toEqual({ key: 'Referrer-Policy', value: 'no-referrer' })
    }
    expect(guestHeaders().map((rule) => rule.source)).toEqual([
      '/m/:path*',
      '/t/:path*',
      '/book/:path*',
    ])
  })

  it('has next.config.ts return them from headers()', async () => {
    // The config loads the repository's .env.local when there is one; a test does not need it.
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
    const { default: config } = await import('./next.config')
    const rules = await config.headers?.()
    // The admin pages' framing rules (DA-O8) follow the guest pages' rules.
    expect(rules).toEqual([...guestHeaders(), ...frameHeaders()])
    const sources = (rules ?? []).map((rule) => rule.source)
    expect(sources).toContain('/m/:path*')
    expect(sources).toContain('/t/:path*')
  })
})

describe('every rule that reaches a path, applied the way Next.js applies them', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** The headers a path ends up with: every matching rule in order, a later key replacing. */
  async function headersOf(path: string): Promise<Record<string, string>> {
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
    const { default: config } = await import('./next.config')
    const found: Record<string, string> = {}
    for (const rule of (await config.headers?.()) ?? []) {
      const pattern = new RegExp(buildCustomRoute('header', rule).regex, 'i')
      if (!pattern.test(path)) continue
      for (const header of rule.headers) found[header.key] = header.value
    }
    return found
  }

  it.each(['/m/club-nosht/main-bar', '/m', '/t/tb_0123456789ABCDEFGHIJKL'])(
    'leaves %s with exactly the headers it had before #581: no referrer and the card form policy',
    async (path) => {
      expect(await headersOf(path)).toEqual({
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': guestContentSecurityPolicy(),
      })
    },
  )

  it.each(['/book/club-nosht/main-bar', `/book/club-nosht/main-bar/${'Ab0_'.repeat(10)}Ab0`])(
    'gives %s no referrer and its own origin as the fallback framing policy, which the proxy replaces with the configured one (#581, D178)',
    async (path) => {
      expect(await headersOf(path)).toEqual({
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "frame-ancestors 'self'",
      })
    },
  )
})

describe("the guest link's token is never printed (#579)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the link's paths out of the request log, and only those", async () => {
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
    const { default: config } = await import('./next.config')
    const logging = config.logging
    const ignore =
      logging !== false && typeof logging?.incomingRequests === 'object'
        ? (logging.incomingRequests.ignore ?? [])
        : []
    const hidden = (path: string) => ignore.some((pattern) => pattern.test(path))
    expect(hidden(`/book/club-nosht/main-bar/${'Ab0_'.repeat(10)}Ab0`)).toBe(true)
    expect(hidden('/api/booking/link/abc?organization=tn_x&venue=vn_y')).toBe(true)
    expect(hidden('/book/club-nosht/main-bar')).toBe(false)
    expect(hidden('/book/club-nosht/main-bar?lang=en')).toBe(false)
    expect(hidden('/api/booking/request')).toBe(false)
  })
})
