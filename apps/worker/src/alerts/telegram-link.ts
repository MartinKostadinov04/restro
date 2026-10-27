// The link an owner opens to connect Telegram (#87, plan `2026-10-27-settings-alerts-export-plan.md`
// A4): `t.me/<bot>?startgroup=<code>` for the venue's group, `t.me/<bot>?start=<code>` for a person.
// The code is signed with a key made from a secret the worker already holds, so nothing new is
// stored: what it names (the venue, and for a person the staff member), what it is for, and when it
// ends (15 minutes) are in the code, and a keyed hash covers them. It is 46 bytes in base64url, 62
// characters of A–Z a–z 0–9 _ - : inside Telegram's 64.
//
// A code is used once: the poller remembers the ones it has accepted until they run out, and a
// group or a person already linked is a change of nothing. Nothing here logs a code.

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

/** Minutes since 2026-01-01 UTC fit in three bytes for 31 years. */
const EPOCH_MS = Date.UTC(2026, 0, 1)
const MINUTE_MS = 60_000
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
  const minutes = Math.floor((input.now.getTime() - EPOCH_MS) / MINUTE_MS) + LINK_MINUTES
  const bytes = new Uint8Array(36)
  bytes[0] = PURPOSES.indexOf(input.purpose)
  bytes[1] = (minutes >> 16) & 0xff
  bytes[2] = (minutes >> 8) & 0xff
  bytes[3] = minutes & 0xff
  bytes.set(venue, 4)
  bytes.set(staff, 20)
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
  if (raw.length !== 36 + MAC_BYTES || raw.toString('base64url') !== code) return null
  const bytes = raw.subarray(0, 36)
  if (!timingSafeEqual(raw.subarray(36), mac(secret, bytes))) return null
  const purpose = PURPOSES[bytes[0] ?? 255]
  if (purpose === undefined) return null
  const minutes = ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
  const expiresAt = new Date(EPOCH_MS + minutes * MINUTE_MS)
  const venueId = idFromBytes('vn', bytes.subarray(4, 20))
  const staffMemberId = purpose === 'person' ? idFromBytes('sm', bytes.subarray(20, 36)) : null
  if (!isId('vn', venueId)) return null
  if (now.getTime() >= expiresAt.getTime()) return 'expired'
  return { purpose, venueId, staffMemberId, expiresAt }
}
