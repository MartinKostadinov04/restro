// The common way a payment provider signs a notice (#108; D127 1.4): a header
// `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">[,v1=…]` under the endpoint's shared secret.
// Checked by hand with node:crypto, never a provider SDK. Each provider's verifier
// (`./<kind>/notices.ts`) says which header carries it and maps its event to a notice.
//
// - The signed text is the raw body exactly as received: parse it only after the check.
// - Any `v1` may match: a provider sends one per active secret while a secret is rolled.
// - Other schemes (`v0`, …) are ignored, never accepted.
// - Compared in constant time, on buffers of equal length only.
// - A timestamp more than the tolerance away from now, either way, is a replay.
import { createHmac, timingSafeEqual } from 'node:crypto'

import type { NoticeRefusalReason } from '@restro/core'

/** The default tolerance: five minutes, the common providers' own. */
export const NOTICE_TOLERANCE_SECONDS = 300

const HEX_SIGNATURE = /^[0-9a-f]{64}$/

/** The header's timestamp and its v1 signatures, or null when it carries no usable signature. */
export function parseSignatureHeader(
  header: string | null,
): { readonly timestamp: number; readonly signatures: readonly string[] } | null {
  if (header === null || header.length > 4_096) return null
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    const key = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (key === 't' && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value)
    else if (key === 'v1' && HEX_SIGNATURE.test(value)) signatures.push(value)
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures }
}

/**
 * Checks a signed body: `null` when a v1 signature matches and the timestamp is within the
 * tolerance, otherwise why not (`unsigned`, `bad_signature`, `stale`).
 */
export function checkSignedBody(
  rawBody: string,
  header: string | null,
  secret: string,
  now: Date,
  toleranceSeconds: number = NOTICE_TOLERANCE_SECONDS,
): Extract<NoticeRefusalReason, 'unsigned' | 'bad_signature' | 'stale'> | null {
  const parsed = parseSignatureHeader(header)
  if (parsed === null) return 'unsigned'
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${parsed.timestamp}.${rawBody}`, 'utf8').digest('hex'),
    'utf8',
  )
  const matches = parsed.signatures.some((signature) => {
    const given = Buffer.from(signature, 'utf8')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
  if (!matches) return 'bad_signature'
  const age = Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp)
  return age > toleranceSeconds ? 'stale' : null
}
