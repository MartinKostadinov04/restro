import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

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
      '/cdn/anything-without-an-extension',
      '/favicon.ico',
      '/logo.png',
    ]) {
      expect(matcher.test(path), path).toBe(false)
    }
  })
})
