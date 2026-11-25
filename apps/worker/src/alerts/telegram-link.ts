// The link an owner opens to connect Telegram (#87, plan `2026-10-27-settings-alerts-export-plan.md`
// A4): `t.me/<bot>?startgroup=<code>` for the venue's group, `t.me/<bot>?start=<code>` for a person.
// The code is signed with a key made from a secret the worker already holds, so nothing new is
// stored: what it names (the venue, and for a person the staff member), what it is for, and when it
// ends (15 minutes, to the millisecond) are in the code, and a keyed hash covers them. It is 48 bytes
// in base64url, 64 characters of A–Z a–z 0–9 _ - : Telegram's limit.
//
// A code is used once: the poller remembers the ones it has accepted until they run out, a restart
// forgets those but `telegram.link` refuses a link made before the group's or the person's latest
// link in the Log (RR-9), and a group or a person already linked is a change of nothing. Nothing
// here logs a code.
//
// The secret is the bot's own token (RR-10): the service token the web app holds, which is enough to
// ask the internal endpoints, can't make a link for any person at any venue.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { type Id, idFromBytes, isId } from '@restro/core'

/** How long a link lasts. */
export const LINK_MINUTES = 15

/** What a link is for. */
export type LinkPurpose = 'group' | 'person'

/** What an opened link names. */
export interface LinkClaims {
  readonly purpose: LinkPurpose
  readonly venueId: Id<'vn'>
  /** The person to link, for a `person` link. */
  readonly staffMemberId: Id<'sm'> | null
  /** When the link ends. */
  readonly expiresAt: Date
}

const LINK_MS = LINK_MINUTES * 60_000

/** When a link was made: its end less its life. */
export function linkIssuedAt(claims: Pick<LinkClaims, 'expiresAt'>): Date {
  return new Date(claims.expiresAt.getTime() - LINK_MS)
}

/** The secret links are signed with, where linking is on (RR-10): never the service token. */
export function linkSecretOf(config: {
  readonly alerts?: { readonly telegramToken: string | null } | null
}): string | null {
  return config.alerts?.telegramToken ?? null
}

/** Milliseconds since 2026-01-01 UTC fit in five bytes for 34 years. */
const EPOCH_MS = Date.UTC(2026, 0, 1)
const TIME_BYTES = 5
const VENUE_AT = 1 + TIME_BYTES
const STAFF_AT = VENUE_AT + 16
const SIGNED_BYTES = STAFF_AT + 16
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BODY = /^[0-9A-Za-z]{22}$/
const MAC_BYTES = 10
const PURPOSES: readonly LinkPurpose[] = ['group', 'person']
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The 16 bytes an id's 22 base62 characters hold, or null when they hold more than 128 bits. */
function bodyBytes(id: string): Uint8Array | null {
  const body = id.slice(3)
  if (!BODY.test(body)) return null
  let value = 0n
  for (const char of body) value = value * 62n + BigInt(BASE62.indexOf(char))
  if (value >= 1n << 128n) return null
  const bytes = new Uint8Array(16)
  for (let i = 15; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

/** The signing key: separated from every other use of the secret by its purpose text. */
function linkKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('restro:telegram-link:v1').digest()
}

function mac(secret: string, bytes: Uint8Array): Buffer {
  return createHmac('sha256', linkKey(secret)).update(bytes).digest().subarray(0, MAC_BYTES)
}

/** Makes a link's code. `staffMemberId` is for a `person` link only. */
export function makeLinkCode(
  secret: string,
  input: {
    readonly purpose: LinkPurpose
    readonly venueId: Id<'vn'>
    readonly staffMemberId?: Id<'sm'>
    readonly now: Date
  },
): string {
  const venue = bodyBytes(input.venueId)
  const staff =
    input.staffMemberId === undefined ? new Uint8Array(16) : bodyBytes(input.staffMemberId)
  if (venue === null || staff === null)
    throw new TypeError('a link names a venue and a person by id')
  const bytes = Buffer.alloc(SIGNED_BYTES)
  bytes[0] = PURPOSES.indexOf(input.purpose)
  bytes.writeUIntBE(input.now.getTime() - EPOCH_MS + LINK_MS, 1, TIME_BYTES)
  bytes.set(venue, VENUE_AT)
  bytes.set(staff, STAFF_AT)
  return Buffer.concat([bytes, mac(secret, bytes)]).toString('base64url')
}

/**
 * Opens a code: what it names, `expired` when it is genuine but past its time, or null when it is
 * not one of ours (wrong shape, wrong key, altered).
 */
export function openLinkCode(
  secret: string,
  code: string,
  now: Date,
): LinkClaims | 'expired' | null {
  if (!CODE_PATTERN.test(code)) return null
  const raw = Buffer.from(code, 'base64url')
  if (raw.length !== SIGNED_BYTES + MAC_BYTES || raw.toString('base64url') !== code) return null
  const bytes = raw.subarray(0, SIGNED_BYTES)
  if (!timingSafeEqual(raw.subarray(SIGNED_BYTES), mac(secret, bytes))) return null
  const purpose = PURPOSES[bytes[0] ?? 255]
  if (purpose === undefined) return null
  const expiresAt = new Date(EPOCH_MS + bytes.readUIntBE(1, TIME_BYTES))
  const venueId = idFromBytes('vn', bytes.subarray(VENUE_AT, STAFF_AT))
  const staffMemberId =
    purpose === 'person' ? idFromBytes('sm', bytes.subarray(STAFF_AT, SIGNED_BYTES)) : null
  if (!isId('vn', venueId)) return null
  if (now.getTime() >= expiresAt.getTime()) return 'expired'
  return { purpose, venueId, staffMemberId, expiresAt }
}
