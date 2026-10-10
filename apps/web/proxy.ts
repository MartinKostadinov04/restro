// Optimistic gate for the admin: a request without a session cookie goes to /login at once,
// before anything renders. This only looks for the cookie (cheap, no database): a forged or
// expired cookie passes here and is refused by the real check in src/server/session.ts, which
// every page and action runs. Same pattern as the Next.js "Authentication" guide.
import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

import { AUTH_COOKIE_PREFIX } from '@/server/cookie-prefix'

export function proxy(request: NextRequest) {
  if (getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return NextResponse.next()

  const login = new URL('/login', request.url)
  const { pathname, search } = request.nextUrl
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  // Everything except: the sign-in page, Better Auth's own API and the health check, Next.js
  // internals and static files, the development-only field preview (it 404s in production) and
  // `/cdn/`, the published menus and photos, which are public by design (src/server/publish/cdn.ts),
  // and the guest's own pages: `/m/<venue>` (the menu) and `/t/<token>` (a table's QR code).
  matcher: ['/((?!login|api/|_next/|dev/|cdn/|m/|t/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)'],
}
