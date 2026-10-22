// The people side of Tonight (D122 §7; design §5; spec #64, 12; ticket #72): venue roles, staff
// members, their PINs and shared devices. Every command here needs `settings.roles`, which a PIN
// never unlocks; each change is a `record` Log entry, kept 18 months.
//
// - **Roles.** Every venue has the default roles Staff, Manager and Owner, created the first time a
//   command needs them; they are read-only and hold what `DEFAULT_ROLE_PERMISSIONS` says. A venue
//   copies one (or one of its own) to make its own role, then renames it or changes its
//   permissions.
// - **Staff members** belong to the organisation and need no account; one role per venue
//   (an assignment). Restro generates each PIN (`pins.ts`): four digits, unique in the
//   organisation, stored as its HMAC and a copy sealed for the worker. Seeing it again goes through
//   the worker's reveal endpoint, after `pin.reveal` is accepted here.
// - **Who may manage whom.** Nobody hands out more than they hold: a role, an assignment or a
//   copy may carry only permissions the actor holds at the venue, and a person can be renamed,
//   moved, given a new PIN or have their PIN shown only by someone holding `settings.roles` and
//   every permission that person holds, at every venue the person works at. Restro's admin team
//   is exempt: it adds roles and changes rights at any venue (D122 §7; decision log 5.1).
// - **Shared devices.** A signed-in person marks their own browser session as a shared device of
//   the venue; from then on every staff write there asks a PIN (`grants.ts`). Revoking one is done
//   from another session, since a shared device itself never reaches settings.
//
// Nothing here logs or returns a PIN, its HMAC or the pepper.

import {
  authMember,
  sharedDevices,
  staffAssignments,
  staffMembers,
  venueRoles,
  venues,
} from '@restro/db'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { sealStaffPin } from '../seal/staff-pin'
import { serviceDate } from '../service-day'
import type { ServiceTx } from './definition'
import { postgresCode } from './engine'
import { resolveGrants } from './grants'
import { appendLogEntry, type LogEntryInput, recordRetainUntil } from './log'
import {
  DEFAULT_ROLE_KINDS,
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
  grantedPermissions,
  isDefaultRoleKind,
  PERMISSIONS,
  type Permission,
  PermissionSchema,
} from './permissions'
import { generatePin, pinHmac } from './pins'
import { accepted, refused, type ServiceResult } from './results'

/** The most people one `pin.reveal` shows: a venue's whole team. */
export const MAX_REVEALED_PINS = 200

/** A role as a command names it: its id, or a default role by its kind. */
export const RoleRefSchema = z.union([idSchema('rl'), z.enum(DEFAULT_ROLE_KINDS)])

/** A role's name: trimmed, 1–40 characters (the table's check). */
export const RoleNameSchema = z.string().trim().min(1).max(40)

/** A staff member's name: trimmed, 1–60 characters (the table's check). */
export const DisplayNameSchema = z.string().trim().min(1).max(60)

/** A shared device's name: trimmed, 1–40 characters (the table's check). */
export const DeviceNameSchema = z.string().trim().min(1).max(40)

/** A permission list as a command carries it. */
export const PermissionListSchema = z.array(PermissionSchema).max(PERMISSIONS.length)

/** How many times a new PIN is drawn before giving up (the organisation's PINs are nearly all used). */
const PIN_ATTEMPTS = 20

/** Postgres's `unique_violation`. */
const UNIQUE_VIOLATION = '23505'

type Role = typeof venueRoles.$inferSelect
type Member = typeof staffMembers.$inferSelect

// --- helpers ----------------------------------------------------------------------------------

/** What a role holds: the code's list for a default role, its stored list otherwise. */
function roleHolds(role: Pick<Role, 'defaultKind' | 'permissions'>): Permission[] {
  return grantedPermissions(
    isDefaultRoleKind(role.defaultKind)
      ? DEFAULT_ROLE_PERMISSIONS[role.defaultKind]
      : role.permissions,
  )
}

/** True for Restro's admin team, which may grant what it doesn't hold itself (D122 §7). */
function isOperator(stx: ServiceTx): boolean {
  return stx.actor.kind === 'operator'
}

/** The permissions in `wanted` the actor doesn't hold at the venue (none for Restro's admin team). */
function notHeld(stx: ServiceTx, wanted: readonly Permission[]): Permission[] {
  if (isOperator(stx)) return []
  return wanted.filter((permission) => !stx.permissions.has(permission))
}

/**
 * Creates the venue's missing default roles. Called first in a command, before any row lock: two
 * commands creating them at once meet on the unique index, and the second waits for the first.
 */
async function ensureDefaultRoles(stx: ServiceTx): Promise<void> {
  await stx.tx
    .insert(venueRoles)
    .values(
      DEFAULT_ROLE_KINDS.map((kind) => ({
        id: newId('rl'),
        tenantId: stx.tenantId,
        venueId: stx.venueId,
        name: DEFAULT_ROLE_NAMES[kind],
        permissions: grantedPermissions(DEFAULT_ROLE_PERMISSIONS[kind]),
        defaultKind: kind,
        ...stx.provenance,
      })),
    )
    .onConflictDoNothing()
}

/** The id of the role a command names; a default role is created first if the venue lacks it. */
async function roleIdOf(stx: ServiceTx, ref: string): Promise<string | null> {
  if (!isDefaultRoleKind(ref)) return ref
  await ensureDefaultRoles(stx)
  const [role] = await stx.tx
    .select({ id: venueRoles.id })
    .from(venueRoles)
    .where(and(eq(venueRoles.venueId, stx.venueId), eq(venueRoles.defaultKind, ref)))
  return role?.id ?? null
}

/**
 * Locks roles, staff members and shared devices of this command, in the fixed order (rank
 * `staff`, then by key: `dv_` before `rl_` before `sm_`), and returns the rows found.
 */
async function lockStaffRows(
  stx: ServiceTx,
  keys: readonly string[],
): Promise<{
  roles: Map<string, Role>
  members: Map<string, Member>
  devices: Map<string, typeof sharedDevices.$inferSelect>
}> {
  const found = { roles: new Map(), members: new Map(), devices: new Map() }
  for (const key of stx.rows.claim('staff', keys)) {
    if (key.startsWith('rl_')) {
      const [row] = await stx.tx
        .select()
        .from(venueRoles)
        .where(eq(venueRoles.id, key))
        .for('update')
      if (row !== undefined) found.roles.set(key, row)
    } else if (key.startsWith('sm_')) {
      const [row] = await stx.tx
        .select()
        .from(staffMembers)
        .where(eq(staffMembers.id, key))
        .for('update')
      if (row !== undefined) found.members.set(key, row)
    } else if (key.startsWith('dv_')) {
      const [row] = await stx.tx
        .select()
        .from(sharedDevices)
        .where(eq(sharedDevices.id, key))
        .for('update')
      if (row !== undefined) found.devices.set(key, row)
    } else {
      throw new Error(`no staff row has a key like ${key}`)
    }
  }
  return found
}

/** A live role of this venue, or null. */
function liveRoleHere(stx: ServiceTx, role: Role | undefined): Role | null {
  return role !== undefined && role.venueId === stx.venueId && role.archivedAt === null
    ? role
    : null
}

/** A person's live assignments: venue → the role's permissions. */
async function assignmentsOf(
  stx: ServiceTx,
  staffMemberId: string,
): Promise<Map<string, { roleId: string; holds: Permission[] }>> {
  const rows = await stx.tx
    .select({
      venueId: staffAssignments.venueId,
      roleId: staffAssignments.roleId,
      defaultKind: venueRoles.defaultKind,
      permissions: venueRoles.permissions,
    })
    .from(staffAssignments)
    .innerJoin(venueRoles, eq(venueRoles.id, staffAssignments.roleId))
    .where(and(eq(staffAssignments.staffMemberId, staffMemberId), isNull(staffAssignments.endedAt)))
  return new Map(rows.map((row) => [row.venueId, { roleId: row.roleId, holds: roleHolds(row) }]))
}

/**
 * Whether the actor may manage this person: `settings.roles` and every permission the person
 * holds, at every venue the person works at (Restro's admin team: `settings.roles` is enough).
 */
async function mayManage(
  stx: ServiceTx,
  assignments: ReadonlyMap<string, { readonly holds: readonly Permission[] }>,
): Promise<boolean> {
  for (const [venueId, assignment] of assignments) {
    let held = stx.permissions
    if (venueId !== stx.venueId) {
      const grants = await resolveGrants(stx.tx, stx.tenantId, venueId, stx.actor)
      if (!grants.ok) return false
      held = grants.permissions
    }
    if (!held.has('settings.roles')) return false
    if (!isOperator(stx) && assignment.holds.some((permission) => !held.has(permission))) {
      return false
    }
  }
  return true
}

/**
 * A live staff member of this venue the actor may manage, locked; or the refusal. "Of this venue"
 * means a live assignment here: an owner manages their own staff (D122 §7).
 */
async function manageableMember(
  stx: ServiceTx,
  staffMemberId: string,
): Promise<
  | { ok: true; member: Member; assignments: Map<string, { roleId: string; holds: Permission[] }> }
  | { ok: false; result: ServiceResult }
> {
  const { members } = await lockStaffRows(stx, [staffMemberId])
  const member = members.get(staffMemberId)
  if (member === undefined || member.archivedAt !== null) {
    return { ok: false, result: refused(null, 'staff_missing') }
  }
  const assignments = await assignmentsOf(stx, staffMemberId)
  if (!assignments.has(stx.venueId)) return { ok: false, result: refused(null, 'staff_missing') }
  if (!(await mayManage(stx, assignments))) {
    return { ok: false, result: refused(null, 'permission_denied') }
  }
  return { ok: true, member, assignments }
}

/** Appends a Log entry at another venue of the tenant (its own service day). */
async function logAt(stx: ServiceTx, venueId: string, entry: LogEntryInput): Promise<void> {
  if (venueId === stx.venueId) return stx.log(entry)
  const [venue] = await stx.tx
    .select({ timezone: venues.timezone, serviceDayEndsAt: venues.serviceDayEndsAt })
    .from(venues)
    .where(eq(venues.id, venueId))
  if (venue === undefined) return
  await appendLogEntry(
    stx.tx,
    {
      tenantId: stx.tenantId,
      venueId,
      serviceDate: serviceDate(stx.now, venue.timezone, venue.serviceDayEndsAt),
      provenance: stx.provenance,
      via: stx.via,
    },
    entry,
  )
}

/**
 * A permission list as Log details: comma-joined under `key`, spilling into `key2` when it is
 * longer than one detail may be.
 */
function listDetails(key: string, list: readonly string[]): Record<string, string> {
  const details: Record<string, string> = {}
  let part = 1
  let current = ''
  for (const item of list) {
    const next = current === '' ? item : `${current},${item}`
    if (next.length > 200) {
      details[part === 1 ? key : `${key}${part}`] = current
      part += 1
      current = item
    } else {
      current = next
    }
  }
  if (current !== '') details[part === 1 ? key : `${key}${part}`] = current
  return details
}

/** The keys needed to write a PIN: the pepper and the worker's public seal key. */
function pinKeys(stx: ServiceTx): {
  pepper: string
  sealKey: NonNullable<ServiceTx['sealPublicKey']>
} {
  if (stx.pinPepper === null) throw new Error('a new PIN needs the PIN pepper (STAFF_PIN_PEPPER)')
  if (stx.sealPublicKey === null) throw new Error('a new PIN needs the worker’s public seal key')
  return { pepper: stx.pinPepper, sealKey: stx.sealPublicKey }
}

/**
 * Draws PINs until one is free in the organisation and writes it with `write` (an insert of the
 * person, or an update of their PIN), each try inside a savepoint: a PIN another person holds fails
 * on the unique index and is drawn again. False when every try collided.
 */
async function writeNewPin(
  stx: ServiceTx,
  staffMemberId: string,
  write: (pin: { pinHmac: string; pinSealed: string; pinSetAt: Date }) => Promise<unknown>,
  previousHmac: string | null = null,
): Promise<boolean> {
  const { pepper, sealKey } = pinKeys(stx)
  for (let attempt = 0; attempt < PIN_ATTEMPTS; attempt++) {
    const pin = generatePin()
    const hmac = pinHmac(pepper, stx.tenantId, pin)
    if (hmac === previousHmac) continue
    const sealed = sealStaffPin(sealKey, pin, { tenantId: stx.tenantId, staffMemberId })
    await stx.tx.execute(sql`savepoint staff_pin`)
    try {
      await write({ pinHmac: hmac, pinSealed: sealed, pinSetAt: stx.now })
      await stx.tx.execute(sql`release savepoint staff_pin`)
      return true
    } catch (error) {
      if (postgresCode(error) !== UNIQUE_VIOLATION) throw error
      await stx.tx.execute(sql`rollback to savepoint staff_pin`)
    }
  }
  return false
}

/** True when another live role of the venue has this name (case aside). */
async function roleNameTaken(
  stx: ServiceTx,
  name: string,
  except: string | null,
): Promise<boolean> {
  const rows = await stx.tx
    .select({ id: venueRoles.id })
    .from(venueRoles)
    .where(
      and(
        eq(venueRoles.venueId, stx.venueId),
        isNull(venueRoles.archivedAt),
        sql`lower(${venueRoles.name}) = lower(${name})`,
        ...(except === null ? [] : [ne(venueRoles.id, except)]),
      ),
    )
  return rows.length > 0
}

// --- roles ------------------------------------------------------------------------------------

/** `role.copy`: a venue's own role, a copy of a default role or of another of its roles. */
export async function copyRole(
  stx: ServiceTx,
  command: { readonly fromRoleId: string; readonly name: string },
): Promise<ServiceResult> {
  const fromId = await roleIdOf(stx, command.fromRoleId)
  const { roles } = await lockStaffRows(stx, fromId === null ? [] : [fromId])
  const source = liveRoleHere(stx, fromId === null ? undefined : roles.get(fromId))
  if (source === null) return refused(null, 'role_missing')
  const holds = roleHolds(source)
  if (notHeld(stx, holds).length > 0) return refused(null, 'permission_not_held')
  if (await roleNameTaken(stx, command.name, null)) return refused(null, 'role_name_taken')
  const id = newId('rl')
  await stx.tx.insert(venueRoles).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    name: command.name,
    permissions: holds,
    defaultKind: null,
    ...stx.provenance,
  })
  await stx.log({
    kind: 'role.changed',
    toState: 'created',
    details: { roleId: id, fromRoleId: source.id },
  })
  return accepted(null, { details: { roleId: id } })
}

/** `role.update`: renames a venue's own role or changes its permissions. */
export async function updateRole(
  stx: ServiceTx,
  command: {
    readonly roleId: string
    readonly name?: string | undefined
    readonly permissions?: readonly Permission[] | undefined
  },
): Promise<ServiceResult> {
  const { roles } = await lockStaffRows(stx, [command.roleId])
  const role = liveRoleHere(stx, roles.get(command.roleId))
  if (role === null) return refused(null, 'role_missing')
  if (role.defaultKind !== null) return refused(null, 'role_read_only')

  const before = roleHolds(role)
  const after = command.permissions === undefined ? before : grantedPermissions(command.permissions)
  const added = after.filter((permission) => !before.includes(permission))
  const removed = before.filter((permission) => !after.includes(permission))
  if (notHeld(stx, added).length > 0) return refused(null, 'permission_not_held')
  const renamed = command.name !== undefined && command.name !== role.name
  if (renamed && (await roleNameTaken(stx, command.name ?? '', role.id))) {
    return refused(null, 'role_name_taken')
  }
  if (!renamed && added.length === 0 && removed.length === 0) {
    return accepted(null, { details: { roleId: role.id } })
  }

  await stx.tx
    .update(venueRoles)
    .set({
      name: command.name ?? role.name,
      permissions: after,
      ...stx.provenance,
    })
    .where(eq(venueRoles.id, role.id))
  await stx.log({
    kind: 'role.changed',
    toState: 'updated',
    details: {
      roleId: role.id,
      renamed,
      ...listDetails('added', added),
      ...listDetails('removed', removed),
    },
  })
  return accepted(null, { details: { roleId: role.id } })
}

/** `role.archive`: retires a venue's own role nobody holds any more. */
export async function archiveRole(
  stx: ServiceTx,
  command: { readonly roleId: string },
): Promise<ServiceResult> {
  const { roles } = await lockStaffRows(stx, [command.roleId])
  const role = liveRoleHere(stx, roles.get(command.roleId))
  if (role === null) return refused(null, 'role_missing')
  if (role.defaultKind !== null) return refused(null, 'role_read_only')
  const [held] = await stx.tx
    .select({ staffMemberId: staffAssignments.staffMemberId })
    .from(staffAssignments)
    .where(and(eq(staffAssignments.roleId, role.id), isNull(staffAssignments.endedAt)))
    .limit(1)
  if (held !== undefined) return refused(null, 'role_in_use')
  await stx.tx
    .update(venueRoles)
    .set({ archivedAt: stx.now, ...stx.provenance })
    .where(eq(venueRoles.id, role.id))
  await stx.log({ kind: 'role.changed', toState: 'archived', details: { roleId: role.id } })
  return accepted(null, { details: { roleId: role.id } })
}

// --- staff members ----------------------------------------------------------------------------

/** `staff.add`: a new person of the organisation with a role at this venue and a new PIN. */
export async function addStaff(
  stx: ServiceTx,
  command: { readonly displayName: string; readonly roleId: string },
): Promise<ServiceResult> {
  const roleId = await roleIdOf(stx, command.roleId)
  const { roles } = await lockStaffRows(stx, roleId === null ? [] : [roleId])
  const role = liveRoleHere(stx, roleId === null ? undefined : roles.get(roleId))
  if (role === null) return refused(null, 'role_missing')
  if (notHeld(stx, roleHolds(role)).length > 0) return refused(null, 'permission_not_held')

  const id = newId('sm')
  const written = await writeNewPin(stx, id, (pin) =>
    stx.tx.insert(staffMembers).values({
      id,
      tenantId: stx.tenantId,
      displayName: command.displayName,
      ...pin,
      ...stx.provenance,
    }),
  )
  if (!written) return refused(null, 'pins_exhausted')
  await stx.tx.insert(staffAssignments).values({
    tenantId: stx.tenantId,
    staffMemberId: id,
    venueId: stx.venueId,
    roleId: role.id,
    ...stx.provenance,
  })
  await stx.log({ kind: 'staff.changed', toState: 'added', details: { staffMemberId: id } })
  await stx.log({
    kind: 'assignment.changed',
    toState: 'assigned',
    details: { staffMemberId: id, roleId: role.id },
  })
  await stx.log({ kind: 'pin.changed', toState: 'issued', details: { staffMemberId: id } })
  return accepted(null, { details: { staffMemberId: id } })
}

/** `staff.rename`: the name the Log and Tonight show. */
export async function renameStaff(
  stx: ServiceTx,
  command: { readonly staffMemberId: string; readonly displayName: string },
): Promise<ServiceResult> {
  const found = await manageableMember(stx, command.staffMemberId)
  if (!found.ok) return found.result
  if (found.member.displayName === command.displayName) {
    return accepted(null, { details: { staffMemberId: found.member.id } })
  }
  await stx.tx
    .update(staffMembers)
    .set({ displayName: command.displayName, ...stx.provenance })
    .where(eq(staffMembers.id, found.member.id))
  await stx.log({
    kind: 'staff.changed',
    toState: 'renamed',
    details: { staffMemberId: found.member.id },
  })
  return accepted(null, { details: { staffMemberId: found.member.id } })
}

/**
 * `staff.assign`: gives a person a role at this venue, or another one. The person may come from
 * another venue of the organisation; the actor needs the rights to manage them there too.
 */
export async function assignStaff(
  stx: ServiceTx,
  command: { readonly staffMemberId: string; readonly roleId: string },
): Promise<ServiceResult> {
  const roleId = await roleIdOf(stx, command.roleId)
  const keys = roleId === null ? [command.staffMemberId] : [roleId, command.staffMemberId]
  const { roles, members } = await lockStaffRows(stx, keys)
  const role = liveRoleHere(stx, roleId === null ? undefined : roles.get(roleId))
  if (role === null) return refused(null, 'role_missing')
  const member = members.get(command.staffMemberId)
  if (member === undefined || member.archivedAt !== null) return refused(null, 'staff_missing')
  if (notHeld(stx, roleHolds(role)).length > 0) return refused(null, 'permission_not_held')
  const assignments = await assignmentsOf(stx, member.id)
  if (!(await mayManage(stx, assignments))) return refused(null, 'permission_denied')

  const current = assignments.get(stx.venueId)
  if (current?.roleId === role.id) return accepted(null, { details: { staffMemberId: member.id } })
  await stx.tx
    .insert(staffAssignments)
    .values({
      tenantId: stx.tenantId,
      staffMemberId: member.id,
      venueId: stx.venueId,
      roleId: role.id,
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [staffAssignments.tenantId, staffAssignments.staffMemberId, staffAssignments.venueId],
      set: { roleId: role.id, endedAt: null, ...stx.provenance },
    })
  await stx.log({
    kind: 'assignment.changed',
    toState: 'assigned',
    details: {
      staffMemberId: member.id,
      roleId: role.id,
      ...(current === undefined ? {} : { fromRoleId: current.roleId }),
    },
  })
  return accepted(null, { details: { staffMemberId: member.id } })
}

/** `staff.unassign`: the person no longer works at this venue. */
export async function unassignStaff(
  stx: ServiceTx,
  command: { readonly staffMemberId: string },
): Promise<ServiceResult> {
  const found = await manageableMember(stx, command.staffMemberId)
  if (!found.ok) return found.result
  const current = found.assignments.get(stx.venueId)
  await stx.tx
    .update(staffAssignments)
    .set({ endedAt: stx.now, ...stx.provenance })
    .where(
      and(
        eq(staffAssignments.staffMemberId, found.member.id),
        eq(staffAssignments.venueId, stx.venueId),
      ),
    )
  await stx.log({
    kind: 'assignment.changed',
    toState: 'ended',
    details: { staffMemberId: found.member.id, roleId: current?.roleId ?? null },
  })
  return accepted(null, { details: { staffMemberId: found.member.id } })
}

/**
 * `staff.archive`: the person leaves the organisation. Every assignment ends, the PIN is cleared,
 * and the row is kept 18 months while `record` entries name them.
 */
export async function archiveStaff(
  stx: ServiceTx,
  command: { readonly staffMemberId: string },
): Promise<ServiceResult> {
  const found = await manageableMember(stx, command.staffMemberId)
  if (!found.ok) return found.result
  const { member, assignments } = found
  await stx.tx
    .update(staffAssignments)
    .set({ endedAt: stx.now, ...stx.provenance })
    .where(and(eq(staffAssignments.staffMemberId, member.id), isNull(staffAssignments.endedAt)))
  await stx.tx
    .update(staffMembers)
    .set({
      archivedAt: stx.now,
      pinHmac: null,
      pinSealed: null,
      pinSetAt: null,
      retainUntil: recordRetainUntil(stx.now),
      ...stx.provenance,
    })
    .where(eq(staffMembers.id, member.id))
  for (const [venueId, assignment] of [...assignments].sort(([a], [b]) => (a < b ? -1 : 1))) {
    await logAt(stx, venueId, {
      kind: 'assignment.changed',
      toState: 'ended',
      details: { staffMemberId: member.id, roleId: assignment.roleId },
    })
  }
  await stx.log({
    kind: 'staff.changed',
    toState: 'archived',
    details: { staffMemberId: member.id },
  })
  if (member.pinHmac !== null) {
    await stx.log({
      kind: 'pin.changed',
      toState: 'cleared',
      details: { staffMemberId: member.id },
    })
  }
  return accepted(null, { details: { staffMemberId: member.id } })
}

/**
 * `staff.link_account`: the person's own sign-in (optional; D122 §7), or none. The account must
 * be a member of the organisation and no other person's.
 */
export async function linkStaffAccount(
  stx: ServiceTx,
  command: { readonly staffMemberId: string; readonly userId: string | null },
): Promise<ServiceResult> {
  const found = await manageableMember(stx, command.staffMemberId)
  if (!found.ok) return found.result
  const { member } = found
  if (member.userId === command.userId) {
    return accepted(null, { details: { staffMemberId: member.id } })
  }
  if (command.userId !== null) {
    const [membership] = await stx.tx
      .select({ id: authMember.id })
      .from(authMember)
      .where(
        and(eq(authMember.organizationId, stx.tenantId), eq(authMember.userId, command.userId)),
      )
    if (membership === undefined) return refused(null, 'account_unknown')
    const [other] = await stx.tx
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(
        and(
          eq(staffMembers.userId, command.userId),
          isNull(staffMembers.archivedAt),
          ne(staffMembers.id, member.id),
        ),
      )
    if (other !== undefined) return refused(null, 'account_taken')
  }
  await stx.tx
    .update(staffMembers)
    .set({ userId: command.userId, ...stx.provenance })
    .where(eq(staffMembers.id, member.id))
  await stx.log({
    kind: 'staff.changed',
    toState: command.userId === null ? 'account_unlinked' : 'account_linked',
    details: { staffMemberId: member.id },
  })
  return accepted(null, { details: { staffMemberId: member.id } })
}

// --- PINs -------------------------------------------------------------------------------------

/** `pin.reset` ("New PIN"): Restro draws another PIN for the person. */
export async function resetPin(
  stx: ServiceTx,
  command: { readonly staffMemberId: string },
): Promise<ServiceResult> {
  const found = await manageableMember(stx, command.staffMemberId)
  if (!found.ok) return found.result
  const { member } = found
  const written = await writeNewPin(
    stx,
    member.id,
    (pin) =>
      stx.tx
        .update(staffMembers)
        .set({ ...pin, ...stx.provenance })
        .where(eq(staffMembers.id, member.id)),
    member.pinHmac,
  )
  if (!written) return refused(null, 'pins_exhausted')
  await stx.log({
    kind: 'pin.changed',
    toState: member.pinHmac === null ? 'issued' : 'reset',
    details: { staffMemberId: member.id },
  })
  return accepted(null, { details: { staffMemberId: member.id } })
}

/**
 * `pin.reveal`: checks the people are this venue's staff the actor may manage and logs one reveal;
 * the worker's reveal endpoint opens their sealed PINs only after this is accepted.
 */
export async function revealPins(
  stx: ServiceTx,
  command: { readonly staffMemberIds: readonly string[] },
): Promise<ServiceResult> {
  const wanted = [...new Set(command.staffMemberIds)].sort()
  const live = await stx.tx
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(inArray(staffMembers.id, wanted), isNull(staffMembers.archivedAt)))
  if (live.length !== wanted.length) return refused(null, 'staff_missing')
  for (const staffMemberId of wanted) {
    const assignments = await assignmentsOf(stx, staffMemberId)
    if (!assignments.has(stx.venueId)) return refused(null, 'staff_missing')
    if (!(await mayManage(stx, assignments))) return refused(null, 'permission_denied')
  }
  await stx.log({
    kind: 'pin.revealed',
    details: {
      count: wanted.length,
      ...(wanted.length === 1 ? { staffMemberId: wanted[0] } : {}),
    },
  })
  return accepted(null, { details: { count: wanted.length } })
}

// --- shared devices ---------------------------------------------------------------------------

/**
 * `device.mark_shared`: the actor's own browser session becomes a shared device of the venue.
 * Restro's admin team can't: which account sits on the bar device is the venue's choice (D122 §7).
 */
export async function markSharedDevice(
  stx: ServiceTx,
  command: { readonly name: string },
): Promise<ServiceResult> {
  if (stx.actor.kind !== 'user') return refused(null, 'own_session_required')
  const id = newId('dv')
  const [row] = await stx.tx
    .insert(sharedDevices)
    .values({
      id,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      name: command.name,
      sessionId: stx.actor.sessionId,
      ...stx.provenance,
    })
    .onConflictDoNothing()
    .returning({ id: sharedDevices.id })
  if (row === undefined) return refused(null, 'already_shared')
  await stx.log({ kind: 'device.changed', toState: 'shared', details: { deviceId: id } })
  return accepted(null, { details: { deviceId: id } })
}

/** `device.revoke`: the session is an ordinary sign-in again; done from another session. */
export async function revokeSharedDevice(
  stx: ServiceTx,
  command: { readonly deviceId: string },
): Promise<ServiceResult> {
  const { devices } = await lockStaffRows(stx, [command.deviceId])
  const device = devices.get(command.deviceId)
  if (device === undefined || device.venueId !== stx.venueId) return refused(null, 'device_missing')
  if (device.revokedAt !== null) return accepted(null, { details: { deviceId: device.id } })
  await stx.tx
    .update(sharedDevices)
    .set({ revokedAt: stx.now, ...stx.provenance })
    .where(eq(sharedDevices.id, device.id))
  await stx.log({ kind: 'device.changed', toState: 'revoked', details: { deviceId: device.id } })
  return accepted(null, { details: { deviceId: device.id } })
}
