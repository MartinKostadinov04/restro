// Optimistic gate for the admin: a request without a session cookie goes to /login at once,
// before anything renders. This only looks for the cookie (cheap, no database): a forged or
// expired cookie passes here and is refused by the real check in src/server/session.ts, which
// every page and action runs. Same pattern as the Next.js "Authentication" guide.
//
// The booking page (`/book/<organisation>/<venue>[/<token>]`) is public and passes untouched, with
// one header added: which sites may show it in a frame (#581, D178), its own origin and those
// `BOOKING_FRAME_ANCESTORS` names. It is sent here, per request, because the config's `headers()`
// are fixed when the image is built, and this setting belongs to the environment the image runs in.
import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

import { bookingFramePolicy } from '@/frame-headers'
import { AUTH_COOKIE_PREFIX } from '@/server/cookie-prefix'
import { bookingFrameAncestors } from '@/server/env'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/book/')) {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', bookingFramePolicy(bookingFrameAncestors()))
    return response
  }
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
  // and the guest's own pages: `/m/<venue>` (the menu), `/t/<token>` (a table's QR code) and
  // `/book/<organisation>/<venue>` (the booking page, #577), which the second entry matches for its
  // framing header alone (#581).
  matcher: [
    '/((?!login|api/|_next/|dev/|cdn/|m/|t/|book/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)',
    '/book/:path+',
  ],
}
