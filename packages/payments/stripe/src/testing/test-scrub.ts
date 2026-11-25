// What a recording keeps of a Stripe answer (#107): everything the provider reads, nothing
// secret or personal. A `test-*` helper: only tests import it. The recorder hands the scrubbed
// text to the code under test too, so a recording plays back exactly what the run saw.
//
// Removed: keys of any kind, client secrets, webhook secrets, the token of an onboarding link
// (whoever holds it can onboard the account), receipt links, card fingerprints, and every e-mail
// address, phone number, IP address and browser string. Sandbox test cards carry no real person,
// but the scrubbing does not rely on that.

import { withoutSecrets } from '../config'

/** The marker every scrubbed value carries; the scrub test looks for anything that escaped it. */
export const SCRUBBED = 'scrubbed'

/** Keys whose values are personal or identifying, replaced whatever they hold. */
const PERSONAL_KEYS = new Set([
  'email',
  'contact_email',
  'receipt_email',
  'phone',
  'contact_phone',
  'ip',
  'ip_address',
  'user_agent',
  'fingerprint',
])

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

function scrubString(key: string | null, value: string): string {
  if (key !== null && PERSONAL_KEYS.has(key)) return SCRUBBED
  if (key === 'receipt_url') return `https://pay.stripe.com/receipts/${SCRUBBED}`
  // Keys and client secrets go as the provider's own redaction has them (`[key]`,
  // `[client secret]`); an onboarding link, https://connect.stripe.com/setup/s/<account>/<token>,
  // keeps its account.
  return withoutSecrets(value)
    .replace(EMAIL, `${SCRUBBED}@example.com`)
    .replace(
      /^(https:\/\/connect\.stripe\.com\/setup\/[a-z]\/[A-Za-z0-9_]+\/)[^/?#]+/,
      `$1${SCRUBBED}`,
    )
}

function scrubValue(key: string | null, value: unknown): unknown {
  if (typeof value === 'string') return scrubString(key, value)
  if (Array.isArray(value)) return value.map((item) => scrubValue(null, item))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        PERSONAL_KEYS.has(name) && item !== null ? SCRUBBED : scrubValue(name, item),
      ]),
    )
  }
  return value
}

/** A response body as a recording keeps it: JSON scrubbed field by field, other text as text. */
export function scrubBody(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return scrubString(null, text)
  }
  return JSON.stringify(scrubValue(null, parsed))
}

/** What must never appear in a recording; empty when the text is clean. */
export function unscrubbed(text: string): string[] {
  const found: string[] = []
  if (/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}/.test(text)) found.push('a key')
  if (/\bwhsec_[A-Za-z0-9]{6,}/.test(text)) found.push('a webhook secret')
  if (/\b(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/.test(text)) found.push('a client secret')
  for (const email of text.match(EMAIL) ?? []) {
    if (email !== `${SCRUBBED}@example.com`) found.push(`an e-mail address (${email.length} chars)`)
  }
  if (/connect\.stripe\.com\/setup\/[a-z]\/[A-Za-z0-9_]+\/(?!scrubbed\b)[^"/?#]+/.test(text)) {
    found.push('an onboarding link token')
  }
  if (/"fingerprint":"(?!scrubbed")/.test(text)) found.push('a card fingerprint')
  if (/"receipt_url":"(?!https:\/\/pay\.stripe\.com\/receipts\/scrubbed")/.test(text)) {
    found.push('a receipt link')
  }
  return found
}
