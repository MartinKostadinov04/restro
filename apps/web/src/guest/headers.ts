// The response headers of the guest's own pages (next.config.ts `headers()`), kept apart from the
// config so a test can read them without loading the config (which reads the root .env.local).
//
// `Referrer-Policy: no-referrer` on `/m/*` (the menu) and `/t/*` (a table's QR address): the table
// code is the only access control there is (D27) and it sits in the address (`/t/<code>`, then
// the fragment of `/m/<venue>#t=<code>`, D122 §9; an older link may still carry `?t=`). Without a
// policy the browser sends the address as `Referer` to every other origin the page loads from,
// such as a CDN that serves the photos (A5-F5).
//
// `Content-Security-Policy` (#114, D127; design §11): the page loads a payment provider's card
// form, so it says where scripts may come from, which frames it may open and where it may talk to.
// It allows the card forms' hosts (each provider's `connectors/<kind>/card-form-hosts.json`) and what the page already
// used (Cloudflare's Turnstile at Send and Pay, the CDN of the published files), and nothing more.
// It sets only these three directives: images, fonts and styles are not restricted by it.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The hosts a provider's card form needs, per directive. */
interface CardFormHosts {
  readonly script: readonly string[]
  readonly frame: readonly string[]
  readonly connect: readonly string[]
}

/** A host a card form may ask the policy to allow: https, a name (a leading `*.` is fine), a port. */
const HOST_PATTERN = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/

/** The folder of the web app's connectors, next to the guest's folder. */
const CONNECTORS_DIR = join(import.meta.dirname, '..', 'connectors')

/**
 * The hosts every provider's card form needs: the `card-form-hosts.json` in each connector's
 * folder (none for the simulator). Read at config time, so this file names no provider.
 */
export function cardFormHosts(dir: string = CONNECTORS_DIR): CardFormHosts {
  const all: { script: string[]; frame: string[]; connect: string[] } = {
    script: [],
    frame: [],
    connect: [],
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let found: Partial<Record<keyof CardFormHosts, unknown>>
    try {
      found = JSON.parse(readFileSync(join(dir, entry.name, 'card-form-hosts.json'), 'utf8'))
    } catch {
      continue
    }
    for (const key of ['script', 'frame', 'connect'] as const) {
      const hosts = found[key]
      if (!Array.isArray(hosts)) continue
      for (const host of hosts) {
        if (typeof host === 'string' && HOST_PATTERN.test(host)) all[key].push(host)
      }
    }
  }
  return all
}

/** One entry of Next.js's `headers()`. */
export interface HeaderRule {
  source: string
  headers: { key: string; value: string }[]
}

/** The paths of the guest's pages, as Next.js header sources (`:path*` also matches no segment). */
export const GUEST_PAGE_SOURCES = ['/m/:path*', '/t/:path*'] as const

/** Cloudflare's Turnstile (a script and a frame, #76). */
const TURNSTILE_HOST = 'https://challenges.cloudflare.com'

/** The origin of the CDN of the published files, when it is an absolute address. */
function cdnOrigin(base: string | undefined): string | null {
  const configured = base?.trim()
  if (configured === undefined || !/^https?:\/\//.test(configured)) return null
  try {
    return new URL(configured).origin
  } catch {
    return null
  }
}

/**
 * The page's Content-Security-Policy. The page's own scripts are inline (Next.js hydration), so
 * `script-src` keeps `'unsafe-inline'`; `development` adds `'unsafe-eval'` for the dev server only.
 */
export function guestContentSecurityPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
  development = env.NODE_ENV === 'development',
  hosts: CardFormHosts = cardFormHosts(),
): string {
  const cdn = cdnOrigin(env.NEXT_PUBLIC_CDN_BASE_URL)
  const script = [
    "'self'",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
    TURNSTILE_HOST,
    ...hosts.script,
  ]
  const frame = [TURNSTILE_HOST, ...hosts.frame]
  // The dev server's hot reload talks over a web socket.
  const connect = [
    "'self'",
    ...(cdn === null ? [] : [cdn]),
    ...hosts.connect,
    ...(development ? ['ws:', 'wss:'] : []),
  ]
  return [
    `script-src ${script.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
  ].join('; ')
}

/** The header rules of the guest's pages. */
export function guestHeaders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HeaderRule[] {
  return GUEST_PAGE_SOURCES.map((source) => ({
    source,
    headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Content-Security-Policy', value: guestContentSecurityPolicy(env) },
    ],
  }))
}
