// A staff member's PIN as a sealed envelope (`staff_members.pin_sealed`; D122 §7, decision log
// 4.8). The PIN is looked up by its HMAC; the sealed copy lets the venue's owner and Restro's
// admin team see it again. core/service seals a new PIN with the worker's public key; only the
// worker opens one (`openStaffPin`), for the reveal endpoint.

import type { KeyObject } from 'node:crypto'

import { SealError } from './errors'
import { sealSecret } from './seal'

/** A PIN: four digits (D122 §7). */
export const STAFF_PIN_PATTERN = /^[0-9]{4}$/

/** Seals a staff member's PIN for the worker, bound to its tenant and person. */
export function sealStaffPin(
  publicKey: KeyObject | string,
  pin: string,
  context: { readonly tenantId: string; readonly staffMemberId: string },
): string {
  if (!STAFF_PIN_PATTERN.test(pin)) throw new SealError('invalid_payload', 'not a PIN')
  return sealSecret(publicKey, pin, { purpose: 'staff_pin', ...context })
}
