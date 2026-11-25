import { describe, expect, it } from 'vitest'

import { newId } from '../ids'
import {
  checkPassKey,
  type LocationPassClaims,
  openLocationPass,
  passHolds,
  sealLocationPass,
} from './location-pass'

const KEY = 'location-pass-test-key-'.padEnd(48, 'x')
const now = Date.parse('2026-10-26T21:00:00Z')

function claims(over: Partial<LocationPassClaims> = {}): LocationPassClaims {
  return {
    v: 1,
    venueId: newId('vn'),
    sittingId: newId('st'),
    codeGeneration: 3,
    expiresAt: now + 2 * 60 * 60_000,
    consentVersion: 'v1',
    ...over,
  }
}

describe('the location pass', () => {
  it('opens what it sealed, and nothing else', () => {
    const sealed = claims()
    const pass = sealLocationPass(sealed, KEY)
    expect(pass).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(openLocationPass(pass, KEY)).toEqual(sealed)
    expect(openLocationPass(pass, `${KEY}x`)).toBeNull()
    expect(openLocationPass(`${pass}.x`, KEY)).toBeNull()
    expect(openLocationPass('', KEY)).toBeNull()
    expect(openLocationPass('x'.repeat(2_000), KEY)).toBeNull()
  })

  it('refuses a pass whose claims were changed under its seal', () => {
    const [, seal] = sealLocationPass(claims(), KEY).split('.')
    const longer = Buffer.from(JSON.stringify(claims({ expiresAt: now + 99 * 60 * 60_000 })))
    expect(openLocationPass(`${longer.toString('base64url')}.${seal}`, KEY)).toBeNull()
  })

  it('refuses a key shorter than 32 characters, naming the setting only', () => {
    expect(() => checkPassKey('short')).toThrow(/^GUEST_PASS_KEY needs 32/)
    expect(() => sealLocationPass(claims(), 'short')).toThrow(/GUEST_PASS_KEY/)
    expect(() => sealLocationPass(claims(), 'short')).not.toThrow(/short/)
  })

  it('holds only for its venue, code generation and open sitting, until it expires', () => {
    const held = claims()
    const place = {
      venueId: held.venueId,
      codeGeneration: held.codeGeneration,
      sittingId: held.sittingId,
      now: new Date(now),
    }
    expect(passHolds(held, place)).toBe(true)
    expect(passHolds(held, { ...place, venueId: newId('vn') })).toBe(false)
    // Re-issuing the code raises its generation: every pass of the old one dies.
    expect(passHolds(held, { ...place, codeGeneration: 4 })).toBe(false)
    expect(passHolds(held, { ...place, now: new Date(held.expiresAt) })).toBe(false)
  })

  it('never outlives its sitting: ended, or followed by another, it holds no more', () => {
    // A bearer note by design: whoever holds it acts for the sitting, and only for that sitting.
    const held = claims({ expiresAt: now + 6 * 60 * 60_000 })
    const place = {
      venueId: held.venueId,
      codeGeneration: held.codeGeneration,
      now: new Date(now + 60_000),
    }
    expect(passHolds(held, { ...place, sittingId: null })).toBe(false)
    expect(passHolds(held, { ...place, sittingId: newId('st') })).toBe(false)
  })
})
