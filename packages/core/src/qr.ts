// The addresses on a venue's table QR codes (brief S3-07, D61). A code carries one of two kinds of
// address, chosen per venue in `venues.settings.qr`:
//
//   ours   `<base address>/t/<token>`           the base address is a setting, `localhost` while we
//                                               build (D61), the permanent domain later (P53)
//   own    a pattern the venue wrote            `https://menu.club.bg/t/{token}`: a link on the
//                                               venue's own domain that forwards to ours
//
// Nothing here fetches anything: the venue's own address is only ever checked for its shape and
// opened by the manager's browser (the "Open test link" button), never by our server. Pure: no I/O,
// so the admin checks a typed address while it is typed, with the same function the writer uses.

import { z } from 'zod'

import { TABLE_TOKEN_PATTERN } from './guest-files'

/** The two kinds of address on a code. */
export const QR_MODES = ['ours', 'own'] as const
/** `ours`: `<base>/t/<token>`; `own`: the venue's pattern. */
export type QrMode = (typeof QR_MODES)[number]

/** The placeholder a venue's own pattern must contain. */
export const QR_TOKEN_PLACEHOLDER = '{token}'
/** The longest base address and the longest own pattern. */
export const MAX_QR_BASE_URL_LENGTH = 200
export const MAX_QR_PATTERN_LENGTH = 300
/** The longest table name (`t/<token>.json` holds at most this many characters). */
export const MAX_TABLE_LABEL_LENGTH = 40

/** Why an address was refused. The admin turns each into a sentence. */
export type QrAddressProblem =
  /** Nothing typed. */
  | 'empty'
  | 'too_long'
  /** Spaces or control characters. */
  | 'whitespace'
  /** Not an address (`https://…`). */
  | 'not_a_url'
  /** Plain `http://` outside this PC and the local network. */
  | 'not_https'
  /** A name and password in the address. */
  | 'credentials'
  /** A base address with a `?query` or a `#part`; a pattern with a `#part`. */
  | 'query_or_fragment'
  /** The pattern has no `{token}`. */
  | 'missing_token'
  /** `{token}` where the domain is (a different domain per table cannot be forwarded). */
  | 'token_in_host'
  /** Other `{…}` than `{token}` (`{Token}`, `{id}`). */
  | 'unknown_placeholder'

/** The result of checking an address. `value` is what to store and use. */
export type QrAddressCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: QrAddressProblem }

const PRIVATE_IPV4 =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/

/**
 * True for an address that only means something on this PC or the local network: `localhost`,
 * `*.localhost`, `*.local`, a loopback or a private IPv4 address (10.x, 172.16-31.x, 192.168.x).
 * Plain `http://` is accepted for those while the system is built and tested from a phone on the
 * same Wi-Fi; everywhere else it must be `https://`.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    PRIVATE_IPV4.test(host)
  )
}

/** A parsed `http(s)` address, or why it is not one. */
function parseAddress(text: string): { url: URL } | { problem: QrAddressProblem } {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { problem: 'not_a_url' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { problem: 'not_a_url' }
  if (url.hostname === '') return { problem: 'not_a_url' }
  if (url.username !== '' || url.password !== '') return { problem: 'credentials' }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return { problem: 'not_https' }
  return { url }
}

function basicProblem(text: string, maxLength: number): QrAddressProblem | null {
  if (text === '') return 'empty'
  if (text.length > maxLength) return 'too_long'
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return 'whitespace'
  return null
}

/**
 * Checks the base address of "our link" and returns it tidied: the scheme and domain in lower case,
 * no trailing slash. `https://…`, or `http://` for this PC and the local network. No query and no
 * `#part`; a path is kept (`https://club.example/menu` makes `https://club.example/menu/t/<token>`).
 */
export function checkBaseUrl(input: string): QrAddressCheck {
  const text = input.trim()
  const basic = basicProblem(text, MAX_QR_BASE_URL_LENGTH)
  if (basic !== null) return { ok: false, problem: basic }
  const parsed = parseAddress(text)
  if ('problem' in parsed) return { ok: false, problem: parsed.problem }
  const { url } = parsed
  if (url.search !== '' || url.hash !== '' || text.includes('?') || text.includes('#')) {
    return { ok: false, problem: 'query_or_fragment' }
  }
  return { ok: true, value: `${url.origin}${url.pathname.replace(/\/+$/, '')}` }
}

/**
 * Checks the venue's own pattern: `https://` (or `http://` for this PC and the local network), at
 * least one `{token}`, in the path or the query and not in the domain, no other `{…}`, no name
 * and password, no `#part`. The text is returned as typed (trimmed): it is printed as it is.
 */
export function checkOwnPattern(input: string): QrAddressCheck {
  const text = input.trim()
  const basic = basicProblem(text, MAX_QR_PATTERN_LENGTH)
  if (basic !== null) return { ok: false, problem: basic }
  const others = text.split(QR_TOKEN_PLACEHOLDER).join('')
  // A `{Token}` or `{id}` is a typo of the placeholder, which is a better thing to say than "none".
  if (/[{}]/.test(others)) return { ok: false, problem: 'unknown_placeholder' }
  if (!text.includes(QR_TOKEN_PLACEHOLDER)) return { ok: false, problem: 'missing_token' }
  if (text.includes('#')) return { ok: false, problem: 'query_or_fragment' }
  const afterScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const hostPart = afterScheme.split(/[/?]/)[0] ?? ''
  if (hostPart.includes(QR_TOKEN_PLACEHOLDER)) return { ok: false, problem: 'token_in_host' }
  const parsed = parseAddress(text.split(QR_TOKEN_PLACEHOLDER).join('x'.repeat(22)))
  if ('problem' in parsed) return { ok: false, problem: parsed.problem }
  return { ok: true, value: text }
}

/** `<base>/t/<token>`: the address of a table's code in "our link" mode. */
export function ourAddress(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/t/${token}`
}

/** The venue's pattern with the token put in. */
export function ownAddress(pattern: string, token: string): string {
  return pattern.split(QR_TOKEN_PLACEHOLDER).join(token)
}

// --- the setting ---------------------------------------------------------------------------------

/**
 * `venues.settings.qr` as stored (snake_case). Both addresses are kept whichever mode is chosen,
 * so switching back does not lose what was typed. A missing `base_url` means the default.
 */
export const VenueQrSchema = z.strictObject({
  mode: z.enum(QR_MODES),
  base_url: z
    .string()
    .refine((value) => checkBaseUrl(value).ok, 'a base address')
    .optional(),
  own_pattern: z
    .string()
    .refine((value) => checkOwnPattern(value).ok, 'a pattern with {token}')
    .optional(),
})
/** The stored QR setting. */
export type VenueQr = z.output<typeof VenueQrSchema>

/** What the admin and the print sheet work with: the setting with its defaults resolved. */
export interface ResolvedQr {
  /** The mode that is really used: `own` only when a valid pattern is saved. */
  readonly mode: QrMode
  /** The base address of "our link": the saved one, else the default; null when neither exists. */
  readonly baseUrl: string | null
  /** True when `baseUrl` is the default (no address saved). */
  readonly baseIsDefault: boolean
  /** The saved own pattern, or null. */
  readonly ownPattern: string | null
}

/**
 * Reads the QR setting of a venue. A missing or malformed value is "our link with the default
 * base address", never an error. `defaultBaseUrl` is the app's own address from the environment
 * (`PUBLIC_BASE_URL`, else `BETTER_AUTH_URL`).
 */
export function readVenueQr(settings: unknown, defaultBaseUrl: string | null): ResolvedQr {
  const raw =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).qr
      : undefined
  const parsed = VenueQrSchema.safeParse(raw)
  const stored = parsed.success ? parsed.data : null
  const fallback = defaultBaseUrl === null ? null : checkBaseUrl(defaultBaseUrl)
  const defaultBase = fallback?.ok ? fallback.value : null
  const baseUrl = stored?.base_url ?? defaultBase
  const ownPattern = stored?.own_pattern ?? null
  return {
    mode: stored?.mode === 'own' && ownPattern !== null ? 'own' : 'ours',
    baseUrl,
    baseIsDefault: stored?.base_url === undefined,
    ownPattern,
  }
}

/** The address a table's code carries, or null when "our link" has no base address. */
export function qrAddress(qr: ResolvedQr, token: string): string | null {
  if (qr.mode === 'own' && qr.ownPattern !== null) return ownAddress(qr.ownPattern, token)
  return qr.baseUrl === null ? null : ourAddress(qr.baseUrl, token)
}

// --- the table's name ----------------------------------------------------------------------------

/** What a table is called on the guest page: the manager's name for it, else barsy's number. */
export function tableDisplayLabel(table: {
  readonly label: string | null
  readonly placeNum: string | null
}): string | null {
  for (const candidate of [table.label, table.placeNum]) {
    const text = candidate?.trim()
    if (text) return text.slice(0, MAX_TABLE_LABEL_LENGTH).trim()
  }
  return null
}

/** True for a string that can be a QR token (what `/t/<token>` accepts). */
export function isTableToken(value: unknown): value is string {
  return typeof value === 'string' && TABLE_TOKEN_PATTERN.test(value)
}
