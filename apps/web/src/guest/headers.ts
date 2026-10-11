// The response headers of the guest's own pages (next.config.ts `headers()`), kept apart from the
// config so a test can read them without loading the config (which reads the root .env.local).
//
// `Referrer-Policy: no-referrer` on `/m/*` (the menu) and `/t/*` (a table's QR address): the table
// code is the only access control there is (D27) and it sits in the address (`/m/<venue>?t=<code>`).
// Without a policy the browser sends that address as `Referer` to every other origin the page
// loads from, such as a CDN that serves the photos (A5-F5).

/** One entry of Next.js's `headers()`. */
export interface HeaderRule {
  source: string
  headers: { key: string; value: string }[]
}

/** The paths of the guest's pages, as Next.js header sources (`:path*` also matches no segment). */
export const GUEST_PAGE_SOURCES = ['/m/:path*', '/t/:path*'] as const

/** The header rules of the guest's pages. */
export function guestHeaders(): HeaderRule[] {
  return GUEST_PAGE_SOURCES.map((source) => ({
    source,
    headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
  }))
}
