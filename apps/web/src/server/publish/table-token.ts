// /t/<token>: what a table's QR code does (brief S3-03, D61). It reads `t/<token>.json` from the
// publish store (the local store directly, or the CDN when PUBLISH_STORE=r2), never the database,
// and answers with a 302 to `/m/<venue slug>?t=<token>`. A token nobody knows (never made, retired,
// mistyped) gets a small page that says so in Bulgarian and English and names no venue.
//
// The page's words are the admin message files (`tablePage`), so they are reviewed with the rest
// of the interface wording (T44).
import { type PublishStore, readTableTokenFile } from '@restro/assets'
import { TABLE_TOKEN_PATTERN } from '@restro/core'

import bg from '../../../messages/bg.json'
import en from '../../../messages/en.json'
import { logError } from '../log'
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

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

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

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

/** The inactive page as a response (404: the code leads nowhere). */
export function inactivePage(status: 404 | 503 = 404): Response {
  return new Response(inactivePageHtml(), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * The response for `/t/<token>`: a 302 to the venue's menu with the token in `?t=`, or the
 * inactive page. The redirect is a relative address, so it keeps working behind any proxy.
 */
export async function tableTokenResponse(
  token: string,
  source: TokenSource | null,
): Promise<Response> {
  if (!TABLE_TOKEN_PATTERN.test(token)) return inactivePage()
  if (source === null) {
    logError('table_token_source_missing', new Error('no publish store and no absolute CDN address'))
    return inactivePage(503)
  }
  let file: Awaited<ReturnType<typeof readTableTokenFile>>
  try {
    file = await readTableTokenFile(source, token)
  } catch (error) {
    logError('table_token_unreadable', error)
    return inactivePage(503)
  }
  if (file === null) return inactivePage()
  return new Response(null, {
    status: 302,
    headers: { ...HEADERS, Location: `/m/${file.venue_slug}?t=${encodeURIComponent(token)}` },
  })
}
