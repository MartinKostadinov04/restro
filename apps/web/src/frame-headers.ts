// No other site may frame the admin (the designer audit's DA-O8, clickjacking): every page but the
// guest's own (`/m/*`, `/t/*`, `/book/*`) answers `Content-Security-Policy: frame-ancestors 'self'`
// and, for browsers that predate it, `X-Frame-Options: SAMEORIGIN`. Same-origin framing stays
// allowed: the Design page frames its own preview, and the publish preview frames the guest page.
// Files are left alone (the published files under `/cdn/`, Next.js's own under `/_next/`, and any
// path that ends in an extension, such as the service worker, which must carry no policy of its own).
// next.config.ts `headers()` reads this; it is apart from the config so a test can read it without
// loading it.
//
// The booking page (`/book/*`, #581, D178) may also be framed by the sites one setting names
// (`BOOKING_FRAME_ANCESTORS`). The config's rules are fixed at build time, and the image is built
// once and configured per environment, so the proxy (proxy.ts) sends the booking page's policy on
// every request, from the environment it runs in. The config's rule for `/book/*` is the fallback
// should the proxy ever miss a request: its own origin only. It carries no `X-Frame-Options`, which
// cannot name another site.

import type { HeaderRule } from './guest/headers'

/**
 * Every page path except the guest's, as a Next.js header source: the first lookahead keeps `/m`,
 * `/m/…`, `/t/…`, `/book/…`, `/cdn/…` and `/_next/…` out (and lets `/menus` in), the second any
 * path that ends in a file's extension.
 */
export const ADMIN_FRAME_SOURCE =
  '/:path((?!(?:m|t|book|cdn|_next)(?:/|$))(?!.*\\.[a-zA-Z0-9]+$).*)'

/** The booking page's paths, as a Next.js header source (`:path*` also matches no segment). */
export const BOOKING_FRAME_SOURCE = '/book/:path*'

/** The admin's framing policy. */
const ADMIN_FRAME_POLICY = "frame-ancestors 'self'"

/**
 * The booking page's `Content-Security-Policy` (#581, D178): its own origin, then the configured
 * sites (already checked, by `bookingFrameAncestors`). With none, its own origin only.
 */
export function bookingFramePolicy(origins: readonly string[]): string {
  return ["frame-ancestors 'self'", ...origins].join(' ')
}

/** The admin's framing rule, and the booking page's fallback (its own origin only). */
export function frameHeaders(): HeaderRule[] {
  return [
    {
      source: ADMIN_FRAME_SOURCE,
      headers: [
        { key: 'Content-Security-Policy', value: ADMIN_FRAME_POLICY },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    },
    {
      source: BOOKING_FRAME_SOURCE,
      headers: [{ key: 'Content-Security-Policy', value: bookingFramePolicy([]) }],
    },
  ]
}
