// No other site frames the admin (DA-O8). The rule is compiled the way Next.js compiles a
// `headers()` source, and asked which paths it covers: the admin's pages yes, the guest's pages,
// the published files, Next.js's own files and any file (the service worker) no. The booking page
// has its own policy (#581, D178): its own origin, then the configured sites.
import { buildCustomRoute } from 'next/dist/lib/build-custom-route'
import { describe, expect, it } from 'vitest'

import { bookingFramePolicy, frameHeaders } from './frame-headers'

const [rule, booking] = frameHeaders()
if (rule === undefined || booking === undefined) throw new Error('no framing rule')
const pattern = new RegExp(buildCustomRoute('header', rule).regex, 'i')
const bookingPattern = new RegExp(buildCustomRoute('header', booking).regex, 'i')

describe("the admin's framing headers", () => {
  it("say frame-ancestors 'self' and SAMEORIGIN, and nothing else", () => {
    expect(rule.headers).toEqual([
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ])
  })

  it.each([
    '/',
    '/login',
    '/venues',
    '/venues/vn_abc',
    '/venues/vn_abc/design/frame',
    '/settings/general',
    '/no-organization',
    '/menus',
    '/team',
    '/cdnx',
    '/booking',
    '/bookings/x',
    '/api/health',
  ])('cover the admin page %s', (path) => {
    expect(pattern.test(path)).toBe(true)
  })

  it.each([
    '/m',
    '/m/club/venue',
    '/M/club/venue',
    '/t/tb_code',
    '/book',
    '/book/club/venue',
    '/book/club/venue/token',
    '/cdn/tn_1/menu.json',
    '/_next/static/chunk.js',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
  ])("leave %s alone (the guest's pages and files)", (path) => {
    expect(pattern.test(path)).toBe(false)
  })
})

describe("the booking page's framing policy (#581, D178)", () => {
  it('names its own origin alone when no site is configured', () => {
    expect(bookingFramePolicy([])).toBe("frame-ancestors 'self'")
  })

  it('names its own origin, then one configured site', () => {
    expect(bookingFramePolicy(['https://club.example'])).toBe(
      "frame-ancestors 'self' https://club.example",
    )
  })

  it('names its own origin, then three configured sites, in order', () => {
    expect(
      bookingFramePolicy(['https://a.example', 'https://b.example:8443', 'http://localhost:3104']),
    ).toBe("frame-ancestors 'self' https://a.example https://b.example:8443 http://localhost:3104")
  })

  it('falls back, in the config, to its own origin only and no X-Frame-Options', () => {
    expect(booking.headers).toEqual([
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
    ])
    for (const path of ['/book/club/venue', '/book/club/venue/token']) {
      expect(bookingPattern.test(path), path).toBe(true)
    }
    for (const path of ['/booking', '/m/club/venue', '/venues']) {
      expect(bookingPattern.test(path), path).toBe(false)
    }
  })
})
