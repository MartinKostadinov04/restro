// The guest link's token, hash and days (#579): pure.
import { describe, expect, it } from 'vitest'

import { guestBookingLinkPath } from '../menu-address'
import {
  checkGuestLinkKey,
  GUEST_LINK_HASH_PATTERN,
  GUEST_LINK_TOKEN_PATTERN,
  guestLinkExpired,
  guestLinkHashesEqual,
  guestLinkToken,
  guestLinkTokenHash,
} from './booking-link'
import { guestCanCancel } from './reservations/guest-link'

const KEY = `unit-test-key-${'k'.repeat(32)}`
const ID = 'rv_0123456789ABCDEFGHIJKL'
/** Another booking's id. */
const OTHER_ID = 'rv_0123456789ABCDEFGHIJKM'

describe('the guest link token', () => {
  it('is 43 base64url characters, the same for the same booking, another for another', () => {
    const token = guestLinkToken(KEY, ID)
    expect(token).toMatch(GUEST_LINK_TOKEN_PATTERN)
    expect(guestLinkToken(KEY, ID)).toBe(token)
    expect(guestLinkToken(KEY, OTHER_ID)).not.toBe(token)
    expect(guestLinkToken(`other-key-${'o'.repeat(32)}`, ID)).not.toBe(token)
    // It names no id.
    expect(token).not.toContain(ID.slice(3))
  })

  it('refuses a key too short or too long, naming the setting and never the value', () => {
    expect(() => guestLinkToken('short', ID)).toThrow('GUEST_LINK_KEY')
    expect(() => checkGuestLinkKey('x'.repeat(257))).toThrow(/^GUEST_LINK_KEY/)
    try {
      checkGuestLinkKey('secret-but-short')
    } catch (error) {
      expect(String(error)).not.toContain('secret-but-short')
    }
    expect(checkGuestLinkKey(`  ${KEY}  `)).toBe(KEY)
  })
})

describe('the stored hash', () => {
  it('is the SHA-256 hex of any string, malformed or not', () => {
    const token = guestLinkToken(KEY, ID)
    expect(guestLinkTokenHash(token)).toMatch(GUEST_LINK_HASH_PATTERN)
    expect(guestLinkTokenHash('')).toMatch(GUEST_LINK_HASH_PATTERN)
    expect(guestLinkTokenHash('x'.repeat(4000))).toMatch(GUEST_LINK_HASH_PATTERN)
    expect(guestLinkTokenHash(token)).not.toBe(guestLinkTokenHash(`${token}x`))
  })

  it('compares equal only for the same hash, and false for anything that is not one', () => {
    const hash = guestLinkTokenHash(guestLinkToken(KEY, ID))
    expect(guestLinkHashesEqual(hash, hash)).toBe(true)
    expect(guestLinkHashesEqual(hash, guestLinkTokenHash('other'))).toBe(false)
    expect(guestLinkHashesEqual(null, hash)).toBe(false)
    expect(guestLinkHashesEqual('0'.repeat(64), 'not a hash')).toBe(false)
    expect(guestLinkHashesEqual('nope', 'nope')).toBe(false)
    expect(guestLinkHashesEqual(hash.toUpperCase(), hash)).toBe(false)
  })
})

describe('the days a link opens its booking, and its Cancel', () => {
  it('opens through the seventh day after its night, and not after', () => {
    expect(guestLinkExpired('2026-10-23', '2026-10-20')).toBe(false)
    expect(guestLinkExpired('2026-10-23', '2026-10-23')).toBe(false)
    expect(guestLinkExpired('2026-10-23', '2026-10-30')).toBe(false)
    expect(guestLinkExpired('2026-10-23', '2026-10-31')).toBe(true)
    // Across a month's end.
    expect(guestLinkExpired('2026-12-28', '2027-01-04')).toBe(false)
    expect(guestLinkExpired('2026-12-28', '2027-01-05')).toBe(true)
  })

  it('cancels a booking asked for or booked whose night is still to come, nothing else', () => {
    const today = '2026-10-20'
    expect(guestCanCancel({ status: 'requested', serviceDate: '2026-10-23' }, today)).toBe(true)
    expect(guestCanCancel({ status: 'reserved', serviceDate: '2026-10-21' }, today)).toBe(true)
    expect(guestCanCancel({ status: 'reserved', serviceDate: today }, today)).toBe(false)
    for (const status of ['cancelled', 'declined', 'seated', 'finished', 'no_show']) {
      expect(guestCanCancel({ status, serviceDate: '2026-10-23' }, today), status).toBe(false)
    }
  })
})

describe('guestBookingLinkPath', () => {
  it('puts the token in the path after the booking page, never in a query', () => {
    const token = guestLinkToken(KEY, ID)
    expect(guestBookingLinkPath({ organization: 'club', venue: 'main' }, token)).toBe(
      `/book/club/main/${token}`,
    )
  })

  it('throws for a token that is not base64url, and for names that are not slugs', () => {
    for (const token of [
      '',
      'short',
      'has space in it',
      'a/b/c/d/e/f/g/h/i',
      `${'a'.repeat(20)}?x=1`,
    ]) {
      expect(() => guestBookingLinkPath({ organization: 'club', venue: 'main' }, token)).toThrow()
    }
    expect(() =>
      guestBookingLinkPath({ organization: 'Club!', venue: 'main' }, guestLinkToken(KEY, ID)),
    ).toThrow()
  })
})
