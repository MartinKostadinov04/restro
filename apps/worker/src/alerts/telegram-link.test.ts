import { newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { LINK_MINUTES, makeLinkCode, openLinkCode } from './telegram-link'

const SECRET = 'a-reveal-token-of-at-least-32-characters'
const NOW = new Date('2026-10-27T21:00:00Z')
const VENUE = newId('vn')
const STAFF = newId('sm')

describe('the Telegram link code', () => {
  it('fits Telegram’s start parameter: at most 64 of A–Z a–z 0–9 _ -', () => {
    for (const input of [
      { purpose: 'group', venueId: VENUE, now: NOW },
      { purpose: 'person', venueId: VENUE, staffMemberId: STAFF, now: NOW },
    ] as const) {
      const code = makeLinkCode(SECRET, input)
      expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    }
  })

  it('names the venue (and the person) and ends after 15 minutes', () => {
    const group = openLinkCode(
      SECRET,
      makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE, now: NOW }),
      NOW,
    )
    expect(group).toMatchObject({ purpose: 'group', venueId: VENUE, staffMemberId: null })
    const person = openLinkCode(
      SECRET,
      makeLinkCode(SECRET, { purpose: 'person', venueId: VENUE, staffMemberId: STAFF, now: NOW }),
      new Date(NOW.getTime() + 60_000),
    )
    expect(person).toMatchObject({ purpose: 'person', venueId: VENUE, staffMemberId: STAFF })
    expect(
      person !== null && person !== 'expired' && person.expiresAt.getTime(),
    ).toBeLessThanOrEqual(NOW.getTime() + LINK_MINUTES * 60_000)
  })

  it('is expired once its time has gone, and only then', () => {
    const code = makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE, now: NOW })
    expect(openLinkCode(SECRET, code, new Date(NOW.getTime() + 14 * 60_000))).not.toBe('expired')
    expect(openLinkCode(SECRET, code, new Date(NOW.getTime() + 16 * 60_000))).toBe('expired')
  })

  it('is refused with another key, an altered byte, a short or a foreign string', () => {
    const code = makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE, now: NOW })
    expect(openLinkCode('another-secret-of-at-least-32-characters', code, NOW)).toBeNull()
    const altered = `${code.slice(0, 10)}${code[10] === 'A' ? 'B' : 'A'}${code.slice(11)}`
    expect(openLinkCode(SECRET, altered, NOW)).toBeNull()
    expect(openLinkCode(SECRET, code.slice(0, 40), NOW)).toBeNull()
    expect(openLinkCode(SECRET, 'hello', NOW)).toBeNull()
    expect(openLinkCode(SECRET, `${code}!`, NOW)).toBeNull()
  })

  it('is not another venue’s: the venue is in the signed bytes', () => {
    const other = newId('vn')
    const a = makeLinkCode(SECRET, { purpose: 'group', venueId: VENUE, now: NOW })
    const b = makeLinkCode(SECRET, { purpose: 'group', venueId: other, now: NOW })
    expect(a).not.toBe(b)
    expect(openLinkCode(SECRET, b, NOW)).toMatchObject({ venueId: other })
  })
})
