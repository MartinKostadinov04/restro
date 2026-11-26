// The guest's own link to his booking (#579; spec #322 stories 8 and 34): `/book/<organisation>/
// <venue>/<token>` opens that one booking, with no account, and offers a Cancel while its night is
// still to come.
//
// **The token** is 43 base64url characters: the HMAC-SHA256 of the reservation's id under a key
// made from `GUEST_LINK_KEY` (a secret the web app and the worker share), with this link's own
// domain, so it is 256 bits nobody can guess or work out without the key, and it names no id.
// Only its SHA-256 is stored (`reservations.guest_token_hash`, migration 0060), written in the
// command that takes the request; the token itself is never stored, logged or put in a query
// string. It is derived rather than drawn at random because every later email carries the same
// link, and the worker that sends them has only the hash to go on: it works the token out again
// from the id and checks it against the stored hash before putting it in an email.
//
// **Opening it**: the server hashes whatever came in the path, malformed or not, looks the hash up
// and compares it in constant time, so an unknown, a malformed and an expired token take the same
// path and get the same answer. A link stops opening its booking `GUEST_LINK_DAYS` after its night.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { addDaysToDay } from '../service-day'

/** The shortest key accepted: 32 characters (`openssl rand -base64 32` gives 44). */
export const MIN_GUEST_LINK_KEY_LENGTH = 32

/** The longest key accepted. */
export const MAX_GUEST_LINK_KEY_LENGTH = 256

/** A token as the link carries it: 32 bytes in base64url, no padding. */
export const GUEST_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** The longest path segment the server reads as a token before hashing it anyway. */
export const MAX_GUEST_LINK_TOKEN_LENGTH = 128

/**
 * How many days after its night a link still opens the booking (the lead's call on #579: a
 * guest can still read it the morning after, and for a few days more).
 */
export const GUEST_LINK_DAYS = 7

/** Separates this key's HMACs from anything else `GUEST_LINK_KEY` could ever be used for. */
const DOMAIN = 'restro:booking-link:v1'

/** Checks the key before it derives anything; the message names the setting, never its value. */
export function checkGuestLinkKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length < MIN_GUEST_LINK_KEY_LENGTH || trimmed.length > MAX_GUEST_LINK_KEY_LENGTH) {
    throw new Error(
      `GUEST_LINK_KEY needs ${MIN_GUEST_LINK_KEY_LENGTH} to ${MAX_GUEST_LINK_KEY_LENGTH} characters`,
    )
  }
  return trimmed
}

function linkKey(key: string): Buffer {
  return createHmac('sha256', checkGuestLinkKey(key)).update(DOMAIN, 'utf8').digest()
}

/** The token of a reservation's link. Never log it: it opens the booking. */
export function guestLinkToken(key: string, reservationId: string): string {
  return createHmac('sha256', linkKey(key)).update(reservationId, 'utf8').digest('base64url')
}

/**
 * The SHA-256 of a token, as the column keeps it (64 lower-case hex). Any string hashes, so a
 * malformed token is looked up like any other and simply finds nothing.
 */
export function guestLinkTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** A stored hash: SHA-256 as 64 lower-case hex, as the column's check has it. */
export const GUEST_LINK_HASH_PATTERN = /^[0-9a-f]{64}$/

/** A hash that is no token's: what a missing or broken one is compared against. */
const NO_HASH = Buffer.alloc(32)

/**
 * True when two hashes are the same, compared in constant time. False for anything that is not a
 * hash, after the same one comparison.
 */
export function guestLinkHashesEqual(stored: string | null, given: string): boolean {
  const storedOk = stored !== null && GUEST_LINK_HASH_PATTERN.test(stored)
  const givenOk = GUEST_LINK_HASH_PATTERN.test(given)
  const left = storedOk ? Buffer.from(stored, 'hex') : NO_HASH
  const right = givenOk ? Buffer.from(given, 'hex') : NO_HASH
  return timingSafeEqual(left, right) && storedOk && givenOk
}

/**
 * True when `token` is the one the current key gives this reservation, compared in constant time.
 * What makes changing `GUEST_LINK_KEY` revoke every link already sent: a stored hash alone opens
 * nothing. False without a key (after the same one comparison), and for a key the check refuses.
 */
export function guestLinkTokenFits(
  key: string | undefined,
  reservationId: string,
  token: string,
): boolean {
  let expected: string | null = null
  if (key !== undefined) {
    try {
      expected = guestLinkTokenHash(guestLinkToken(key, reservationId))
    } catch {
      expected = null
    }
  }
  return guestLinkHashesEqual(expected, guestLinkTokenHash(token))
}

/**
 * True when a booking's link no longer opens it: its night is more than `GUEST_LINK_DAYS` before
 * `today` (the venue's service day). The night itself and the seven days after still open.
 */
export function guestLinkExpired(serviceDate: string, today: string): boolean {
  return addDaysToDay(serviceDate, GUEST_LINK_DAYS) < today
}
