// The venue permissions of the service side (D122 §7; design `2026-10-21-service-data-design.md`
// §5; spec #64 Implementation Decisions 12). A fixed list in code: a venue role holds some of
// them, organisation owners and admins hold all of them implicitly, and Restro's admin team holds
// its own few. Which permissions each default role carries is #72's; this file is only the list
// the commands declare and the check reads.
//
// Pure data: no I/O.

import { z } from 'zod'

/** Every permission a command may need or a role may hold. */
export const PERMISSIONS = [
  /** Open, close, Open all, Close all, New guests. */
  'tables.open_close',
  /** Resume a paused table. */
  'tables.resume',
  /** Pause ordering, all bars or one. */
  'ordering.pause',
  /** Lift a staff pause. */
  'ordering.lift',
  /** Done on live alerts and waiter calls, money alerts included. */
  'alerts.answer',
  /** Mark and unmark sold out. */
  'sold_out',
  /** The Log. */
  'log.view',
  /** End-of-night sections 1–3, without tips. */
  'night.view',
  /** The whole end-of-night page, tips and CSV. */
  'night.view_full',
  /** Storno done, Mark as disputed, Dispute evidence. */
  'money.follow_up',
  /** Guards, limits, service hours, the pre-opening check. */
  'settings.guards',
  /** Re-issue table codes. */
  'settings.codes',
  /** Mark payment tables. */
  'settings.payment_tables',
  /** Alert recipients, the Telegram group. */
  'settings.alerts',
  /** Roles, staff, PINs, shared devices. */
  'settings.roles',
] as const

/** One venue permission. */
export type Permission = (typeof PERMISSIONS)[number]

/** Zod schema of one permission key. */
export const PermissionSchema = z.enum(PERMISSIONS)

/** True for a key on the list. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

/**
 * A settings permission: it needs a person's own sign-in, so a PIN on a shared device never
 * unlocks it (D122 §7: a guessed PIN never reaches settings).
 */
export function isSettingsPermission(permission: Permission): boolean {
  return permission.startsWith('settings.')
}

/**
 * What Restro's admin team holds at any venue (D122 §7; spec #64, 12): it adds roles, changes
 * rights and manages staff PINs (`settings.roles`), and lifts any pause (`ordering.lift`).
 */
export const OPERATOR_PERMISSIONS: readonly Permission[] = ['settings.roles', 'ordering.lift']

/**
 * The permissions a role's stored list grants: the keys on the list, in the list's order. A key
 * the code no longer knows grants nothing.
 */
export function grantedPermissions(stored: unknown): Permission[] {
  if (!Array.isArray(stored)) return []
  const held = new Set(stored.filter(isPermission))
  return PERMISSIONS.filter((permission) => held.has(permission))
}
