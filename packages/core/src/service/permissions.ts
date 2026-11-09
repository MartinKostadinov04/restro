// The venue permissions of the service side (D122 §7; design `2026-10-21-service-data-design.md`
// §5; spec #64 Implementation Decisions 12). A fixed list in code: a venue role holds some of
// them, organisation owners and admins hold all of them implicitly, and Restro's admin team holds
// its own few. The default roles (Staff, Manager, Owner) carry the design's §5 table, which is
// what a venue starts from: a preselection it may tick and untick in place, not a fixed set
// (Martin 11-09, ticket #366; this supersedes the 10-21 clause that a venue copies a default role
// rather than editing it). `roleGrants` below is the one place that decides what any role holds.
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
  // Reservations (D141, the lead's calls; ticket #323). Any role a venue makes can be given each
  // of them, and no role has one because of its name: there is no reservations-only account and
  // no job title anywhere in this list.
  /** Working tonight's reservations: arrivals, walk-ins, the waiting list, the plan's taps. */
  'reservations.tonight',
  /** The booking book: create, edit, cancel, delete another's, restore, copy to another night. */
  'reservations.manage',
  /** Set a reservation's pay rule (D136; ticket #334 uses it). */
  'reservations.pay_rule',
  /** Block and unblock a table (D137: a block is a reservation). */
  'reservations.block',
  /** Write a night that has passed, where the venue switched that on (D135). */
  'reservations.edit_past',
  /** End the night, with its preview and its open-bills warning (D138). */
  'reservations.end_night',
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
  /** The venue's reservation settings: the turn time, the past-nights switch, where the PIN falls. */
  'settings.reservations',
  /**
   * The venue's guest records (D140), erasing a guest among them. Settings-class on purpose: a PIN
   * on a shared device can never reach it, so erasing somebody always has a person's own sign-in
   * behind it (D141).
   */
  'settings.guests',
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

/**
 * The eight reservation permissions (D141; ticket #324): the six `reservations.*` keys and the two
 * settings keys nothing but reservations uses. Working the door is a permission, not a job title:
 * any role a venue makes can be given these, and no role holds one because of its name. The
 * default roles below carry the table of #324 — staff work tonight's reservations, a manager holds
 * all eight — and a venue that wants it otherwise ticks its own on the role itself (#366).
 */
const RESERVATION_PERMISSIONS: readonly Permission[] = [
  'reservations.tonight',
  'reservations.manage',
  'reservations.pay_rule',
  'reservations.block',
  'reservations.edit_past',
  'reservations.end_night',
  'settings.reservations',
  'settings.guests',
]

/**
 * What staff hold: tables, pauses, alerts, the night's first sections (design §5) and tonight's
 * reservations — the arrivals, walk-ins and waiting list of whoever is on the floor.
 */
const STAFF_PERMISSIONS: readonly Permission[] = [
  'tables.open_close',
  'tables.resume',
  'ordering.pause',
  'alerts.answer',
  'night.view',
  'reservations.tonight',
]

/**
 * What a manager holds: everything staff hold, plus lifting a pause, sold out, the Log, the whole
 * night, money follow-ups and all eight reservation permissions — the booking book, the pay rule,
 * blocks, past nights, ending the night, and the two reservation settings. Those last two are the
 * one place a default role below the owner holds a settings key, so a manager needs their own
 * sign-in for them: a PIN on a shared device never reaches a settings permission (D141).
 *
 * Kept in the list's own order, each key once (`grantedPermissions`), so a hand-written duplicate
 * can't change what a role holds.
 */
const MANAGER_PERMISSIONS: readonly Permission[] = grantedPermissions([
  ...STAFF_PERMISSIONS,
  'ordering.lift',
  'sold_out',
  'log.view',
  'night.view_full',
  'money.follow_up',
  ...RESERVATION_PERMISSIONS,
])

/**
 * What each default role holds as Restro ships it (design §5's table; D122 §7; #324 for the
 * reservation keys); the owner holds every permission.
 *
 * **A permission added here does not reach every venue at once any more** (Martin 11-09, #366;
 * decision log 4.5's promise no longer holds as written). It reaches a default role the venue has
 * never edited, because such a role reads this table. On a default role the venue has edited it
 * arrives unticked — the row is the authority there, and nothing is granted behind the venue's
 * back — and the owner finds it in its group, marked as newly added, to tick if they want it. The
 * owner role is the one exception: it holds every permission, edits or none, so a new key reaches
 * it everywhere (`roleGrants`). `role-grants.test.ts` pins all of this.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<DefaultRoleKind, readonly Permission[]>> = {
  staff: STAFF_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  owner: PERMISSIONS,
}

/**
 * True when what a person holds at a venue is the Staff default role's rights or fewer, and not
 * none: the account a bar tablet signs in with (RR-O35, Martin 11-06: "a staff-only account"). An
 * owner or admin of the organisation holds every permission and a manager more than staff (the
 * money alerts and the tips, RR-92), so none of them is one; nor is an account with no role here.
 *
 * The ceiling is what Restro ships as staff, not what the venue's Staff role holds today (#366):
 * a venue that edits Staff to hold less still sets up its tablet, and one that edits it to hold
 * more cannot widen this door by doing so. Only tightens (D67).
 */
export function holdsStaffRightsOnly(held: Iterable<string>): boolean {
  const staff = new Set<string>(STAFF_PERMISSIONS)
  let any = false
  for (const permission of held) {
    if (!staff.has(permission)) return false
    any = true
  }
  return any
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

/**
 * The default roles a venue may tick and untick in place (Martin 11-09, #366). The owner role is
 * not one of them: an owner who could take `settings.roles` off their own role would lock the
 * venue out of the role editor, with no way back in from inside the app.
 */
export const EDITABLE_DEFAULT_ROLE_KINDS: readonly DefaultRoleKind[] = ['staff', 'manager']

/** True for a default role a venue may edit (every kind but the owner's). */
export function isEditableDefaultKind(value: unknown): value is DefaultRoleKind {
  return isDefaultRoleKind(value) && EDITABLE_DEFAULT_ROLE_KINDS.includes(value)
}

/**
 * A role row as every reader of it sees it: its kind, its stored ticks, and the keys the code knew
 * when the venue last edited it (null while the venue has never edited it).
 */
export interface RoleRow {
  readonly defaultKind: string | null
  readonly permissions: unknown
  readonly knownPermissions: unknown
}

/** True once the venue has edited this role, so its own row decides what it holds. */
export function roleIsEdited(role: RoleRow): boolean {
  return Array.isArray(role.knownPermissions)
}

/**
 * **What a role holds — the one authority** (Martin 11-09, #366). Everything that asks what a role
 * may do reads this: `grants.ts` (what a person may actually do), `staff-read.ts` (what the role
 * editor shows) and the worker's alert delivery (who an alert reaches). A role that granted
 * somewhere what the editor does not show would be a security bug, not a display bug, so there is
 * one function and `role-grants.test.ts` holds the three to it.
 *
 * - The **owner** role holds every permission, whatever its row says: it is fixed (#366), and a
 *   row edited by hand in the database cannot lock a venue out of its own role editor.
 * - A **default role the venue has never edited** (`known_permissions` null) holds what
 *   `DEFAULT_ROLE_PERMISSIONS` says, so a permission Restro adds reaches it.
 * - **Anything else** — a default role the venue has edited, or a role the venue made itself —
 *   holds its own stored ticks, and only those. A key the code no longer knows grants nothing.
 */
export function roleGrants(role: RoleRow): Permission[] {
  if (role.defaultKind === 'owner') return [...PERMISSIONS]
  if (isDefaultRoleKind(role.defaultKind) && !roleIsEdited(role)) {
    return grantedPermissions(DEFAULT_ROLE_PERMISSIONS[role.defaultKind])
  }
  return grantedPermissions(role.permissions)
}

/**
 * The permissions Restro added after the venue last edited this role: on the list now, unticked,
 * and not even offered when the venue made its choice. The role editor marks them, so a new
 * ability is found rather than missed (#366). None on a role the venue has never edited — such a
 * role follows the code table, so nothing is new to it — and none on the owner's, which holds
 * every permission anyway.
 */
export function newPermissionsOf(role: RoleRow): Permission[] {
  if (role.defaultKind === 'owner' || !roleIsEdited(role)) return []
  const known = new Set(grantedPermissions(role.knownPermissions))
  return PERMISSIONS.filter((permission) => !known.has(permission))
}
