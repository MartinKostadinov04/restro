// No other site frames the admin (DA-O8). The rule is compiled the way Next.js compiles a
// `headers()` source, and asked which paths it covers: the admin's pages yes, the guest's pages,
// the published files, Next.js's own files and any file (the service worker) no.
import { buildCustomRoute } from 'next/dist/lib/build-custom-route'
import { describe, expect, it } from 'vitest'

import { frameHeaders } from './frame-headers'

const [rule] = frameHeaders()
if (rule === undefined) throw new Error('no framing rule')
const pattern = new RegExp(buildCustomRoute('header', rule).regex, 'i')

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
    '/api/health',
  ])('cover the admin page %s', (path) => {
    expect(pattern.test(path)).toBe(true)
  })

  it.each([
    '/m',
    '/m/club/venue',
    '/M/club/venue',
    '/t/tb_code',
    '/cdn/tn_1/menu.json',
    '/_next/static/chunk.js',
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
  ])("leave %s alone (the guest's pages and files)", (path) => {
    expect(pattern.test(path)).toBe(false)
  })
})
