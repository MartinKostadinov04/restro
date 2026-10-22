// Staff PINs (D122 §7; #72): Restro draws four digits and never a weak one, the HMAC is keyed by
// the pepper and bound to the tenant, a short pepper is refused without showing it, a session is
// fresh for 15 minutes, and the default roles hold what the design's table says.
import { describe, expect, it } from 'vitest'

import { FRESH_SIGN_IN_MINUTES, isFreshSignIn } from './context'
import {
  DEFAULT_ROLE_KINDS,
  DEFAULT_ROLE_PERMISSIONS,
  isDefaultRoleKind,
  PERMISSIONS,
} from './permissions'
import { checkPinPepper, generatePin, isWeakPin, MIN_PIN_PEPPER_LENGTH, pinHmac } from './pins'

const PEPPER = 'p'.repeat(MIN_PIN_PEPPER_LENGTH)
const TENANT = 'tn_0123456789ABCDEFGHIJKL'

describe('staff PINs', () => {
  it('are four digits and never weak', () => {
    for (let index = 0; index < 2000; index += 1) {
      const pin = generatePin()
      expect(pin).toMatch(/^[0-9]{4}$/)
      expect(isWeakPin(pin)).toBe(false)
    }
  })

  it('call a repeated digit or a run up or down weak, and nothing else', () => {
    for (const pin of ['0000', '7777', '1234', '6789', '4321', '3210']) {
      expect(isWeakPin(pin), pin).toBe(true)
    }
    for (const pin of ['1235', '0007', '2468', '1212', '9081'])
      expect(isWeakPin(pin), pin).toBe(false)
  })

  it('are looked up by an HMAC keyed by the pepper and bound to the tenant', () => {
    const hmac = pinHmac(PEPPER, TENANT, '4821')
    expect(hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(pinHmac(PEPPER, TENANT, '4821')).toBe(hmac)
    expect(pinHmac(PEPPER, 'tn_0123456789ABCDEFGHIJKM', '4821')).not.toBe(hmac)
    expect(pinHmac(`${PEPPER}x`, TENANT, '4821')).not.toBe(hmac)
    expect(pinHmac(PEPPER, TENANT, '4822')).not.toBe(hmac)
    expect(() => pinHmac(PEPPER, TENANT, '48a1')).toThrow('not a PIN')
  })

  it('refuse a short pepper, naming the setting and never its value', () => {
    const short = 'secret-but-short'
    expect(() => checkPinPepper(short)).toThrow('STAFF_PIN_PEPPER')
    expect(() => pinHmac(short, TENANT, '4821')).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(short) }),
    )
    expect(checkPinPepper(PEPPER)).toBe(PEPPER)
  })
})

describe('a fresh sign-in', () => {
  const now = new Date('2026-10-22T21:00:00Z')
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

  it('lasts 15 minutes from the password', () => {
    expect(FRESH_SIGN_IN_MINUTES).toBe(15)
    expect(isFreshSignIn(ago(0), now)).toBe(true)
    expect(isFreshSignIn(ago(14.9), now)).toBe(true)
    expect(isFreshSignIn(ago(15), now)).toBe(false)
    expect(isFreshSignIn(ago(60 * 24), now)).toBe(false)
  })

  it('is not fresh when the time is missing or far in the future', () => {
    expect(isFreshSignIn(undefined, now)).toBe(false)
    expect(isFreshSignIn(ago(-0.5), now)).toBe(true)
    expect(isFreshSignIn(ago(-5), now)).toBe(false)
  })
})

describe('the default roles (design §5)', () => {
  it('are staff, manager and owner, each holding more than the one before', () => {
    expect(DEFAULT_ROLE_KINDS).toEqual(['staff', 'manager', 'owner'])
    const [staff, manager, owner] = DEFAULT_ROLE_KINDS.map((kind) => DEFAULT_ROLE_PERMISSIONS[kind])
    for (const permission of staff ?? []) expect(manager).toContain(permission)
    for (const permission of manager ?? []) expect(owner).toContain(permission)
    expect([...(owner ?? [])].sort()).toEqual([...PERMISSIONS].sort())
    expect(isDefaultRoleKind('owner')).toBe(true)
    expect(isDefaultRoleKind(null)).toBe(false)
  })

  it('give staff Tonight only, and keep settings to the owner', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.staff].sort()).toEqual(
      [
        'alerts.answer',
        'night.view',
        'ordering.pause',
        'tables.open_close',
        'tables.resume',
      ].sort(),
    )
    for (const kind of ['staff', 'manager'] as const) {
      expect(
        DEFAULT_ROLE_PERMISSIONS[kind].some((p) => p.startsWith('settings.')),
        kind,
      ).toBe(false)
    }
  })
})
