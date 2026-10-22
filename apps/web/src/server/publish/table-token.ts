// /t/<code>: what a table's QR code does (brief S3-03, D61). It hashes the code (#70) and reads
// `t/<hash>.json` from the publish store (the local store directly, or the CDN when
// PUBLISH_STORE=r2), never the database, and answers with a 302 to the venue's menu with the code
// in the fragment, `#t=<code>` (D122 §9: never in a query string, and no Referer):
// `/m/<organisation>/<venue>` when the file names the organisation (D84), else the address of
// before, `/m/<slug>-<code>` (D68). A slug in the file may be stale after a rename, which the
// guest page corrects. A code nobody knows (never made, retired, mistyped) gets a small page that
// says so in Bulgarian and English and names no venue, and counts against the network it came
// from (guard/bad-codes.ts): past D122's limits the network is blocked for a while.
//
// The page's words are the admin message files (`tablePage`), so they are reviewed with the rest
// of the interface wording (T44).
import { type PublishStore, readTableTokenFile } from '@restro/assets'
import { guestMenuPath, hashTableCode, menuPath, TABLE_TOKEN_PATTERN } from '@restro/core'

import bg from '../../../messages/bg.json'
import en from '../../../messages/en.json'
import type { BadCodeLimiter } from '../guard/bad-codes'
import { logError, logWarn } from '../log'
import { getLocalPublishStore } from './store'

/** Where the token files are read from: the store's own `get`, or the CDN over HTTP. */
export type TokenSource = Pick<PublishStore, 'get'>

/** The CDN as a read-only source: `GET <base>/<path>`, 404 = no file. */
export function cdnSource(base: string, fetchFile: typeof fetch = fetch): TokenSource {
  return {
    async get(path) {
      const response = await fetchFile(`${base.replace(/\/+$/, '')}/${path}`, { cache: 'no-store' })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`the CDN answered ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

/**
 * The source for this process: the local publish store, else the CDN named by
 * NEXT_PUBLIC_CDN_BASE_URL (it must be an absolute address here: a relative one only means
 * something to a browser), else none.
 */
export async function getTokenSource(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TokenSource | null> {
  const local = await getLocalPublishStore()
  if (local !== null) return local
  const base = env.NEXT_PUBLIC_CDN_BASE_URL?.trim()
  return base && /^https?:\/\//.test(base) ? cdnSource(base) : null
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** The "not active" page: both languages, system colours, no venue data, nothing for a search engine. */
export function inactivePageHtml(): string {
  const block = (lang: string, message: { title: string; text: string }) =>
    `<section lang="${lang}"><h1>${escapeHtml(message.title)}</h1><p>${escapeHtml(message.text)}</p></section>`
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(bg.tablePage.title)} / ${escapeHtml(en.tablePage.title)}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100dvh; display: grid; place-content: center; gap: 28px; padding: 24px; text-align: center; font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
h1 { margin: 0 0 4px; font-size: 1.375rem; font-weight: 600; }
p { margin: 0; color: GrayText; }
</style>
</head>
<body>
${block('bg', bg.tablePage)}
${block('en', en.tablePage)}
</body>
</html>
`
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  // The code is in this address: no other origin may see it as a Referer (D122 §9).
  'Referrer-Policy': 'no-referrer',
}

/**
 * The inactive page as a response: 404 (the code leads nowhere), 503 (the files cannot be read)
 * or 429 (the network tried too many wrong codes; `retryAfterSeconds` says for how long).
 */
export function inactivePage(status: 404 | 429 | 503 = 404, retryAfterSeconds?: number): Response {
  return new Response(inactivePageHtml(), {
    status,
    headers: {
      ...HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      ...(retryAfterSeconds === undefined ? {} : { 'Retry-After': String(retryAfterSeconds) }),
    },
  })
}

/** The limiter and the network a request came from (guard/bad-codes.ts). */
export interface CodeGuard {
  readonly limiter: BadCodeLimiter
  readonly network: string
}

/** Counts a wrong code against the network: the inactive page, or 429 once it is blocked. */
function wrongCode(guard: CodeGuard | null): Response {
  if (guard === null) return inactivePage()
  const { verdict, turnstileNow, blockedNow } = guard.limiter.recordWrong(guard.network)
  // Never the network or the code. Turnstile is not on the page yet: the line is only logged.
  if (turnstileNow) logWarn('bad_code_turnstile_required')
  if (blockedNow) logWarn('bad_code_block')
  return verdict.kind === 'blocked' ? inactivePage(429, verdict.retryAfterSeconds) : inactivePage()
}

/**
 * The response for `/t/<code>`: a 302 to the venue's menu with the code in the fragment, or the
 * inactive page. The redirect is a relative address, so it keeps working behind any proxy.
 * `guard` counts wrong codes per network (null in tests that do not look at it).
 */
export async function tableTokenResponse(
  token: string,
  source: TokenSource | null,
  guard: CodeGuard | null = null,
): Promise<Response> {
  const before = guard?.limiter.check(guard.network)
  if (before?.kind === 'blocked') return inactivePage(429, before.retryAfterSeconds)
  if (!TABLE_TOKEN_PATTERN.test(token)) return wrongCode(guard)
  if (source === null) {
    logError(
      'table_token_source_missing',
      new Error('no publish store and no absolute CDN address'),
    )
    return inactivePage(503)
  }
  let file: Awaited<ReturnType<typeof readTableTokenFile>>
  try {
    file = await readTableTokenFile(source, await hashTableCode(token))
  } catch (error) {
    logError('table_token_unreadable', error)
    return inactivePage(503)
  }
  if (file === null) return wrongCode(guard)
  const menu =
    file.organization_slug === undefined
      ? menuPath({ slug: file.venue_slug, publicId: file.venue_public_id })
      : guestMenuPath({ organization: file.organization_slug, venue: file.venue_slug })
  return new Response(null, {
    status: 302,
    headers: { ...HEADERS, Location: `${menu}#t=${encodeURIComponent(token)}` },
  })
}
