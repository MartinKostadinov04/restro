// No other site may frame the admin (the designer audit's DA-O8, clickjacking): every page but the
// guest's own (`/m/*`, `/t/*`) answers `Content-Security-Policy: frame-ancestors 'self'` and, for
// browsers that predate it, `X-Frame-Options: SAMEORIGIN`. Same-origin framing stays allowed: the
// Design page frames its own preview, and the publish preview frames the guest page. Files are left
// alone (the published files under `/cdn/`, Next.js's own under `/_next/`, and any path that ends
// in an extension, such as the service worker, which must carry no policy of its own). next.config.ts
// `headers()` reads this; it is apart from the config so a test can read it without loading it.

import type { HeaderRule } from './guest/headers'

/**
 * Every page path except the guest's, as a Next.js header source: the first lookahead keeps `/m`,
 * `/m/…`, `/t/…`, `/cdn/…` and `/_next/…` out (and lets `/menus` in), the second any path that ends
 * in a file's extension.
 */
export const ADMIN_FRAME_SOURCE = '/:path((?!(?:m|t|cdn|_next)(?:/|$))(?!.*\\.[a-zA-Z0-9]+$).*)'

/** The admin's framing rule. */
export function frameHeaders(): HeaderRule[] {
  return [
    {
      source: ADMIN_FRAME_SOURCE,
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    },
  ]
}
