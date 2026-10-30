// The permission check (D122 §7; design §5; spec #64, 12): what the actor may do at one venue,
// read in the command's own transaction, on the server only. The interface only hides what this
// would refuse anyway.
// - An organisation's owner or admin (`auth_member.role`) holds every permission at every venue,
//   implicitly, so nobody can lock the organisation out.
// - Anyone else holds their venue role's permissions, through their one assignment at the venue. A
//   default role holds what the code says it holds (`DEFAULT_ROLE_PERMISSIONS`), never its stored
//   copy, so a permission shipped later reaches every venue's defaults at once.
// - On a shared device every staff write needs the person's own PIN, and that person's role
//   decides, never the signed-in account's. A PIN never unlocks a settings permission. The one
//   exception is a quick answer (`quickOnSharedDevice`) and the Tonight read: the device's own
//   account holds what the Staff default role holds.
// - Restro's admin team holds its own few permissions at any venue while its grant is active.
// The roles, staff and PINs themselves are written by `staff.ts` (#72); this is only the check.

import {
  authMember,
  operators,
  sharedDevices,
  staffAssignments,
  staffMembers,
  venueRoles,
} from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq, isNull } from 'drizzle-orm'

import type { ServiceActor } from './context'
import {
  DEFAULT_ROLE_PERMISSIONS,
  grantedPermissions,
  isDefaultRoleKind,
  isSettingsPermission,
  OPERATOR_PERMISSIONS,
  PERMISSIONS,
  type Permission,
} from './permissions'

/** The read side of a transaction: the check never writes. */
type ReadOnly = Pick<WriteTx, 'select'>

/** What the actor holds at the venue, or why the actor can't act there at all. */
export type Grants =
  | {
      readonly ok: true
      readonly permissions: ReadonlySet<Permission>
      /** True when a shared device's own account holds them, without a person's PIN. */
      readonly device?: true
    }
  | { readonly ok: false; readonly code: 'pin_required' | 'actor_unknown' }

const NONE: Grants = { ok: true, permissions: new Set() }

/** The organisation roles that hold every venue permission. */
const ALL_PERMISSION_ROLES: ReadonlySet<string> = new Set(['owner', 'admin'])

/** True for a Better Auth role text naming an owner or admin (it may join several with commas). */
function holdsEverything(role: string): boolean {
  return role
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => ALL_PERMISSION_ROLES.has(part))
}

/**
 * The venue whose live shared device is signed in with `sessionId`, or null. A session is at most
 * one live device of an organisation (`shared_devices_session_unique`).
 */
async function sharedDeviceVenueOf(
  tx: ReadOnly,
  tenantId: string,
  sessionId: string,
): Promise<string | null> {
  const [device] = await tx
    .select({ venueId: sharedDevices.venueId })
    .from(sharedDevices)
    .where(
      and(
        eq(sharedDevices.tenantId, tenantId),
        eq(sharedDevices.sessionId, sessionId),
        isNull(sharedDevices.revokedAt),
      ),
    )
  return device?.venueId ?? null
}

/** The permissions of a staff member's live assignment at the venue; none without one. */
async function assignedPermissions(
  tx: ReadOnly,
  venueId: string,
  staffMemberId: string,
): Promise<Permission[]> {
  const [role] = await tx
    .select({ permissions: venueRoles.permissions, defaultKind: venueRoles.defaultKind })
    .from(staffAssignments)
    .innerJoin(venueRoles, eq(venueRoles.id, staffAssignments.roleId))
    .where(
      and(
        eq(staffAssignments.staffMemberId, staffMemberId),
        eq(staffAssignments.venueId, venueId),
        isNull(staffAssignments.endedAt),
        eq(venueRoles.venueId, venueId),
        isNull(venueRoles.archivedAt),
      ),
    )
  if (role === undefined) return []
  return grantedPermissions(
    isDefaultRoleKind(role.defaultKind)
      ? DEFAULT_ROLE_PERMISSIONS[role.defaultKind]
      : role.permissions,
  )
}

/**
 * What `actor` holds at `venueId` in tenant `tenantId`. Guests and the worker hold no venue
 * permission (their commands declare none).
 */
export async function resolveGrants(
  tx: ReadOnly,
  tenantId: string,
  venueId: string,
  actor: ServiceActor,
  options: { readonly quick?: boolean } = {},
): Promise<Grants> {
  switch (actor.kind) {
    case 'guest':
    case 'system':
    case 'integration':
      return NONE
    case 'operator': {
      const [grant] = await tx
        .select({ userId: operators.userId })
        .from(operators)
        .where(and(eq(operators.userId, actor.userId), isNull(operators.revokedAt)))
      if (grant === undefined) return { ok: false, code: 'actor_unknown' }
      return { ok: true, permissions: new Set(OPERATOR_PERMISSIONS) }
    }
    case 'staff': {
      // A PIN is entered only on a shared device of this venue.
      if ((await sharedDeviceVenueOf(tx, tenantId, actor.sessionId)) !== venueId) {
        return { ok: false, code: 'actor_unknown' }
      }
      const [member] = await tx
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(and(eq(staffMembers.id, actor.staffMemberId), isNull(staffMembers.archivedAt)))
      if (member === undefined) return { ok: false, code: 'actor_unknown' }
      const held = await assignedPermissions(tx, venueId, member.id)
      return { ok: true, permissions: new Set(held.filter((p) => !isSettingsPermission(p))) }
    }
    case 'user': {
      // A tablet is a device everywhere in the organisation (RR-84, D122 §7): its account may hold
      // everything, so at another venue it holds nothing, quick answers included. A PIN isn't good
      // there either, so this refuses rather than asks for one.
      const deviceVenue = await sharedDeviceVenueOf(tx, tenantId, actor.sessionId)
      if (deviceVenue !== null && deviceVenue !== venueId) {
        return { ok: false, code: 'actor_unknown' }
      }
      const onDevice = deviceVenue !== null
      if (onDevice && options.quick !== true) return { ok: false, code: 'pin_required' }
      const [membership] = await tx
        .select({ role: authMember.role })
        .from(authMember)
        .where(and(eq(authMember.organizationId, tenantId), eq(authMember.userId, actor.userId)))
      if (membership === undefined) return { ok: false, code: 'actor_unknown' }
      // A quick answer on the shared device: the device's account holds what Staff hold, whoever
      // owns the account, so a tablet signed in as an owner can't do more than a PIN could.
      if (onDevice) {
        const held = DEFAULT_ROLE_PERMISSIONS.staff.filter((p) => !isSettingsPermission(p))
        return { ok: true, permissions: new Set(held), device: true }
      }
      if (holdsEverything(membership.role)) return { ok: true, permissions: new Set(PERMISSIONS) }
      const [member] = await tx
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(and(eq(staffMembers.userId, actor.userId), isNull(staffMembers.archivedAt)))
      if (member === undefined) return NONE
      return { ok: true, permissions: new Set(await assignedPermissions(tx, venueId, member.id)) }
    }
  }
}
