// The read side of the people settings (#72; screens #87): a venue's roles, its staff and its
// shared devices, for someone holding `settings.roles` there. Read-only on `withTenant`. A default
// role the venue hasn't created yet is listed from the code, with no id: a command names it by
// its kind. No PIN or HMAC is ever read here; whether a person has a PIN is all that shows.

import {
  type DbPool,
  sharedDevices,
  staffAssignments,
  staffMembers,
  venueRoles,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, eq, isNull } from 'drizzle-orm'

import type { ServiceActor } from './context'
import { resolveGrants } from './grants'
import {
  DEFAULT_ROLE_KINDS,
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
  type DefaultRoleKind,
  grantedPermissions,
  isDefaultRoleKind,
  type Permission,
} from './permissions'

/** One role as the settings show it. */
export interface RoleView {
  /** Null for a default role the venue hasn't created yet (name it by `defaultKind`). */
  readonly id: string | null
  readonly name: string
  readonly defaultKind: DefaultRoleKind | null
  /** A default role can't be changed, only copied (D122 §7). */
  readonly readOnly: boolean
  readonly permissions: readonly Permission[]
}

/** One person working at the venue. */
export interface StaffView {
  readonly id: string
  readonly displayName: string
  readonly roleId: string
  readonly hasPin: boolean
  readonly pinSetAt: Date | null
  /** True when the person has their own sign-in. */
  readonly hasAccount: boolean
}

/** A live shared device of the venue. */
export interface DeviceView {
  readonly id: string
  readonly name: string
  readonly createdAt: Date
  /** True for the session that is asking (it can't revoke itself). */
  readonly isThisSession: boolean
}

/** The people settings of one venue. */
export interface StaffSettings {
  readonly roles: readonly RoleView[]
  readonly staff: readonly StaffView[]
  /** People of the organisation with no role here, who can be given one (`staff.assign`). */
  readonly others: readonly { readonly id: string; readonly displayName: string }[]
  readonly devices: readonly DeviceView[]
}

/** Why the settings can't be read. */
export type StaffSettingsRefusal =
  | 'venue_missing'
  | 'venue_archived'
  | 'pin_required'
  | 'actor_unknown'
  | 'permission_denied'

/** The venue's roles, staff and shared devices, for an actor holding `settings.roles` there. */
export async function readStaffSettings(
  pool: DbPool,
  input: { readonly tenantId: string; readonly venueId: string; readonly actor: ServiceActor },
): Promise<
  | { readonly ok: true; readonly settings: StaffSettings }
  | { readonly ok: false; readonly code: StaffSettingsRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const [venue] = await tx
      .select({ id: venues.id, archivedAt: venues.archivedAt })
      .from(venues)
      .where(eq(venues.id, input.venueId))
    if (venue === undefined) return { ok: false, code: 'venue_missing' } as const
    if (venue.archivedAt !== null) return { ok: false, code: 'venue_archived' } as const
    const grants = await resolveGrants(tx, input.tenantId, venue.id, input.actor)
    if (!grants.ok) return { ok: false, code: grants.code } as const
    if (!grants.permissions.has('settings.roles')) {
      return { ok: false, code: 'permission_denied' } as const
    }

    const stored = await tx
      .select()
      .from(venueRoles)
      .where(and(eq(venueRoles.venueId, venue.id), isNull(venueRoles.archivedAt)))
      .orderBy(asc(venueRoles.createdAt), asc(venueRoles.id))
    const defaults: RoleView[] = DEFAULT_ROLE_KINDS.map((kind) => {
      const row = stored.find((role) => role.defaultKind === kind)
      return {
        id: row?.id ?? null,
        name: row?.name ?? DEFAULT_ROLE_NAMES[kind],
        defaultKind: kind,
        readOnly: true,
        permissions: grantedPermissions(DEFAULT_ROLE_PERMISSIONS[kind]),
      }
    })
    const own: RoleView[] = stored
      .filter((role) => !isDefaultRoleKind(role.defaultKind))
      .map((role) => ({
        id: role.id,
        name: role.name,
        defaultKind: null,
        readOnly: false,
        permissions: grantedPermissions(role.permissions),
      }))

    const people = await tx
      .select({
        id: staffMembers.id,
        displayName: staffMembers.displayName,
        pinSetAt: staffMembers.pinSetAt,
        userId: staffMembers.userId,
        roleId: staffAssignments.roleId,
      })
      .from(staffMembers)
      .leftJoin(
        staffAssignments,
        and(
          eq(staffAssignments.staffMemberId, staffMembers.id),
          eq(staffAssignments.venueId, venue.id),
          isNull(staffAssignments.endedAt),
        ),
      )
      .where(isNull(staffMembers.archivedAt))
      .orderBy(asc(staffMembers.displayName), asc(staffMembers.id))
    const staff: StaffView[] = []
    const others: { id: string; displayName: string }[] = []
    for (const person of people) {
      if (person.roleId === null) {
        others.push({ id: person.id, displayName: person.displayName })
      } else {
        staff.push({
          id: person.id,
          displayName: person.displayName,
          roleId: person.roleId,
          hasPin: person.pinSetAt !== null,
          pinSetAt: person.pinSetAt,
          hasAccount: person.userId !== null,
        })
      }
    }

    const sessionId = 'sessionId' in input.actor ? input.actor.sessionId : null
    const devices = await tx
      .select({
        id: sharedDevices.id,
        name: sharedDevices.name,
        createdAt: sharedDevices.createdAt,
        sessionId: sharedDevices.sessionId,
      })
      .from(sharedDevices)
      .where(and(eq(sharedDevices.venueId, venue.id), isNull(sharedDevices.revokedAt)))
      .orderBy(asc(sharedDevices.createdAt), asc(sharedDevices.id))

    return {
      ok: true,
      settings: {
        roles: [...defaults, ...own],
        staff,
        others,
        devices: devices.map((device) => ({
          id: device.id,
          name: device.name,
          createdAt: device.createdAt,
          isThisSession: device.sessionId === sessionId,
        })),
      },
    } as const
  })
}
