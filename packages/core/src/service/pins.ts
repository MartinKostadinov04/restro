// Staff PINs (D122 §7; design §5; decision log 4.3, 4.8). Restro generates every PIN, so nobody
// learns that a PIN they picked is taken (someone else's). A PIN is four digits, unique in the
// organisation, and stored twice:
// - `pin_hmac`: HMAC-SHA256 under the PIN pepper (`STAFF_PIN_PEPPER`, kept in the environment) of
//   `<tenant id>|<pin>`, the key a shared device looks the person up by;
// - `pin_sealed`: a copy sealed for the worker, which the reveal endpoint opens for the venue's
//   owner and Restro's admin team.
// Neither the PIN, its HMAC nor the pepper is ever logged.

import { createHmac, randomInt } from 'node:crypto'

import { STAFF_PIN_PATTERN } from '../seal/staff-pin'

/** The shortest pepper accepted: 32 characters (`openssl rand -base64 32` gives 44). */
export const MIN_PIN_PEPPER_LENGTH = 32

/** A PIN's digits. */
const PIN_DIGITS = 4

/**
 * True for a PIN a guesser tries first: one digit four times (0000, 7777) or a run up or down
 * (1234, 4321). Restro never hands these out.
 */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number)
  const steps = new Set(digits.slice(1).map((digit, index) => digit - (digits[index] ?? 0)))
  return steps.size === 1 && [0, 1, -1].includes([...steps][0] ?? 99)
}

/** A new random PIN that is not weak. */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0')
    if (!isWeakPin(pin)) return pin
  }
}

/** Checks the pepper before it keys anything; the message names the setting, never its value. */
export function checkPinPepper(pepper: string): string {
  if (pepper.trim().length < MIN_PIN_PEPPER_LENGTH) {
    throw new Error(`STAFF_PIN_PEPPER needs ${MIN_PIN_PEPPER_LENGTH} or more characters`)
  }
  return pepper
}

/** `HMAC(pepper, tenant ‖ pin)` as 64 hex digits: what `staff_members.pin_hmac` holds. */
export function pinHmac(pepper: string, tenantId: string, pin: string): string {
  if (!STAFF_PIN_PATTERN.test(pin)) throw new TypeError('not a PIN')
  return createHmac('sha256', checkPinPepper(pepper)).update(`${tenantId}|${pin}`).digest('hex')
}
