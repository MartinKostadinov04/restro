import { afterEach, describe, expect, it, vi } from 'vitest'

import { GUEST_PAGE_SOURCES, guestHeaders } from './src/guest/headers'

// The real headers on a running server are checked by e2e/guest.spec.ts. This reads the config
// itself: the rule has to be wired in, not just defined.
describe('the guest pages send no referrer (A5-F5)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defines Referrer-Policy: no-referrer for the menu and the table address', () => {
    expect(GUEST_PAGE_SOURCES).toEqual(['/m/:path*', '/t/:path*'])
    expect(guestHeaders()).toEqual([
      { source: '/m/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/t/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ])
  })

  it('has next.config.ts return them from headers()', async () => {
    // The config loads the repository's .env.local when there is one; a test does not need it.
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
    const { default: config } = await import('./next.config')
    const rules = await config.headers?.()
    expect(rules).toEqual(guestHeaders())
    const sources = (rules ?? []).map((rule) => rule.source)
    expect(sources).toContain('/m/:path*')
    expect(sources).toContain('/t/:path*')
  })
})
