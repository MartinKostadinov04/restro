// The venue permissions of the service side (D122 §7; design `2026-10-21-service-data-design.md`
// §5; spec #64 Implementation Decisions 12). A fixed list in code: a venue role holds some of
// them, organisation owners and admins hold all of them implicitly, and Restro's admin team holds
// its own few. The default roles (Staff, Manager, Owner) carry the design's §5 table, fixed here:
// a venue can't change them, it copies one to make its own (D122 §7; decision log 4.5).
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
  /** Connect, reconnect and disconnect the venue's payment account; tick the owner's checks (D125 2.2). */
  'settings.connect_payments',
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
 * rights and manages staff PINs (`settings.roles`), lifts any pause (`ordering.lift`), connects a
 * venue's payment account (`settings.connect_payments`, D125 2.2), and reads the Log, where its
 * own alerts are (`log.view`, RR-55).
 */
export const OPERATOR_PERMISSIONS: readonly Permission[] = [
  'settings.roles',
  'ordering.lift',
  'settings.connect_payments',
  'log.view',
]

/** The default roles every venue has (D122 §7; decision log 4.4: the names are Martin's). */
export const DEFAULT_ROLE_KINDS = ['staff', 'manager', 'owner'] as const

/** One default role. */
export type DefaultRoleKind = (typeof DEFAULT_ROLE_KINDS)[number]

/** True for a default role's kind. */
export function isDefaultRoleKind(value: unknown): value is DefaultRoleKind {
  return typeof value === 'string' && (DEFAULT_ROLE_KINDS as readonly string[]).includes(value)
}

/** The stored name of each default role; a screen words it through its own strings. */
export const DEFAULT_ROLE_NAMES: Readonly<Record<DefaultRoleKind, string>> = {
  staff: 'Staff',
  manager: 'Manager',
  owner: 'Owner',
}

/** What staff hold: tables, pauses, alerts and the night's first sections (design §5). */
const STAFF_PERMISSIONS: readonly Permission[] = [
  'tables.open_close',
  'tables.resume',
  'ordering.pause',
  'alerts.answer',
  'night.view',
]

/**
 * What each default role holds (design §5's table; D122 §7). A manager also lifts a pause, marks
 * sold out, sees the Log and the whole night, and follows up money; the owner holds every
 * permission. A permission added to the list later reaches a default role only through this table,
 * and so reaches every venue at once (decision log 4.5).
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<DefaultRoleKind, readonly Permission[]>> = {
  staff: STAFF_PERMISSIONS,
  manager: [
    ...STAFF_PERMISSIONS,
    'ordering.lift',
    'sold_out',
    'log.view',
    'night.view_full',
    'money.follow_up',
  ],
  owner: PERMISSIONS,
}

/**
 * The permissions a role's stored list grants: the keys on the list, in the list's order. A key
 * the code no longer knows grants nothing.
 */
export function grantedPermissions(stored: unknown): Permission[] {
  if (!Array.isArray(stored)) return []
  const held = new Set(stored.filter(isPermission))
  return PERMISSIONS.filter((permission) => held.has(permission))
}
