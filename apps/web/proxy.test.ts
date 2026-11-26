import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { config, proxy } from './proxy'

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

describe('proxy (the optimistic sign-in gate)', () => {
  it('sends a visitor without a session cookie to /login and remembers where they were going', () => {
    const response = proxy(request('/venues/vn_x?tab=settings'))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/venues/vn_x?tab=settings')
  })

  it('does not add ?next= for the home page', () => {
    const location = new URL(proxy(request('/')).headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.search).toBe('')
  })

  it('lets a request with the session cookie through (the real check is in each page)', () => {
    const response = proxy(request('/venues', 'restro.session_token=abc.def'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not read another application’s cookie as a session', () => {
    const response = proxy(request('/venues', 'better-auth.session_token=abc.def'))
    expect(response.status).toBe(307)
  })

  it('matches the admin pages but not sign-in, the API, assets or the dev preview', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)
    for (const path of ['/', '/venues', '/venues/vn_x', '/no-organization']) {
      expect(matcher.test(path), path).toBe(true)
    }
    for (const path of [
      '/login',
      '/api/auth/sign-in/email',
      '/api/health',
      '/_next/static/chunks/a.js',
      '/dev/fields',
      '/cdn/m/nd_x/vn_x/current.json',
      '/m/demo-club',
      '/t/tb_0123456789ABCDEFGHIJKL',
      '/book/night-group/club-night',
      '/cdn/anything-without-an-extension',
      '/favicon.ico',
      '/logo.png',
      // Staff devices fetch these with no sign-in: the browser asks for them itself (RR-86).
      '/sw.js',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
    ]) {
      expect(matcher.test(path), path).toBe(false)
    }
  })
})

describe("proxy (the booking page's framing policy, #581, D178)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('runs on the booking page and its guest links, as a second matcher entry', () => {
    expect(config.matcher).toEqual([config.matcher[0], '/book/:path+'])
  })

  it.each(['/book/night-group/club-night', `/book/night-group/club-night/${'Ab0_'.repeat(10)}Ab0`])(
    'lets %s through with no sign-in, and names only its own origin by default',
    (path) => {
      vi.stubEnv('BOOKING_FRAME_ANCESTORS', '')
      const response = proxy(request(path))
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
      expect(response.headers.get('x-frame-options')).toBeNull()
    },
  )

  it('names the configured sites, read from the environment it runs in', () => {
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', 'https://club.example, http://localhost:3104')
    const response = proxy(request('/book/night-group/club-night', 'restro.session_token=abc.def'))
    expect(response.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://club.example http://localhost:3104",
    )
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', 'https://other.example')
    expect(
      proxy(request('/book/night-group/club-night')).headers.get('content-security-policy'),
    ).toBe("frame-ancestors 'self' https://other.example")
  })

  it('sends no framing header elsewhere: the admin keeps its config rule', () => {
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', 'https://club.example')
    const response = proxy(request('/venues', 'restro.session_token=abc.def'))
    expect(response.headers.get('content-security-policy')).toBeNull()
  })
})
