// The location pass (D121, D122 §4; design §5; ticket #76). After a passed location check the
// server hands the phone a note sealed with HMAC-SHA256 under `GUEST_PASS_KEY`: the venue, the
// table code's generation, the sitting, the expiry and the consent version. The phone sends it
// back on its next requests; seeing the bill and the order, and changing on-the-bill lines, need
// one that still holds. Restro keeps no copy and no phone identity.
//
// It holds only while the sitting it names is the table's open sitting and the code generation is
// the table's: ending the sitting or re-issuing the code kills every pass at once, and it never
// outlives its expiry, which is cut at the service day's end (`locationPassExpiry`).
//
// A bearer note by design (the decision log's accepted risk): whoever holds it acts for the
// sitting until it expires. The key, the pass and its claims are never logged.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { idSchema } from '../ids'

/** The shortest key accepted: 32 characters (`openssl rand -base64 32` gives 44). */
export const MIN_PASS_KEY_LENGTH = 32

/** The longest pass the server reads; a real one is about 250 characters. */
export const MAX_PASS_LENGTH = 1_024

/** What a pass says. */
export const LocationPassClaimsSchema = z.strictObject({
  v: z.literal(1),
  venueId: idSchema('vn'),
  sittingId: idSchema('st'),
  codeGeneration: z.int().positive(),
  /** Milliseconds since the epoch. */
  expiresAt: z.int().positive(),
  consentVersion: z.string().min(1).max(16),
})

/** What a pass says. */
export type LocationPassClaims = z.infer<typeof LocationPassClaimsSchema>

/** Separates this HMAC's inputs from any other the key could ever sign. */
const DOMAIN = 'restro.location-pass.v1.'

/** Checks the key before it signs anything; the message names the setting, never its value. */
export function checkPassKey(key: string): string {
  if (key.trim().length < MIN_PASS_KEY_LENGTH) {
    throw new Error(`GUEST_PASS_KEY needs ${MIN_PASS_KEY_LENGTH} or more characters`)
  }
  return key
}

function mac(key: string, body: string): Buffer {
  return createHmac('sha256', checkPassKey(key))
    .update(DOMAIN + body)
    .digest()
}

/** Seals the claims into a pass: `<base64url claims>.<base64url HMAC>`. */
export function sealLocationPass(claims: LocationPassClaims, key: string): string {
  const body = Buffer.from(JSON.stringify(LocationPassClaimsSchema.parse(claims))).toString(
    'base64url',
  )
  return `${body}.${mac(key, body).toString('base64url')}`
}

/** The claims of a pass whose seal is good, or null for anything else. Expiry is not checked here. */
export function openLocationPass(pass: string, key: string): LocationPassClaims | null {
  if (pass.length > MAX_PASS_LENGTH) return null
  const [body, seal, ...rest] = pass.split('.')
  if (body === undefined || seal === undefined || rest.length > 0) return null
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(seal)) return null
  const given = Buffer.from(seal, 'base64url')
  const expected = mac(key, body)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const parsed = LocationPassClaimsSchema.safeParse(
      JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Where a pass is presented: the code's venue and generation, the open sitting, the clock. */
export interface PassPlace {
  readonly venueId: string
  readonly codeGeneration: number
  /** The table's open sitting, or null when the table is not open. */
  readonly sittingId: string | null
  readonly now: Date
}

/** True while the claims hold here: same venue, code generation and open sitting, not expired. */
export function passHolds(claims: LocationPassClaims, place: PassPlace): boolean {
  return (
    place.sittingId !== null &&
    claims.venueId === place.venueId &&
    claims.codeGeneration === place.codeGeneration &&
    claims.sittingId === place.sittingId &&
    claims.expiresAt > place.now.getTime()
  )
}
