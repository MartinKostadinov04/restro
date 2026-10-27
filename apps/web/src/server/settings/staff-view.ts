// What the Staff and roles section draws (#87, plan `2026-10-27-settings-staff-roles-plan.md`),
// made from core's `readStaffSettings` and `readVenueAccess` by plain functions. Plain data, safe
// for the browser: our ids and public fields only (rule 3). No PIN, HMAC or seal is ever read.
import {
  DEFAULT_ROLE_KINDS,
  type Permission,
  readStaffSettings,
  type StaffSettings,
} from '@restro/core/service'
import { authMember, authUser } from '@restro/db'
import { eq } from 'drizzle-orm'

import { getAuthDb, getPool } from '../db'
import { isOperator } from '../staff/service'

/** One role as the screen draws it. */
export interface StaffRoleView {
  /** What a command names it by: its id, or for a default role the venue lacks yet, its kind. */
  readonly ref: string
  readonly name: string
  readonly defaultKind: (typeof DEFAULT_ROLE_KINDS)[number] | null
  readonly readOnly: boolean
  readonly permissions: readonly Permission[]
  readonly people: number
}

/** One person working at the venue. */
export interface StaffPersonView {
  readonly id: string
  readonly name: string
  /** The role's `ref`. */
  readonly roleRef: string
  readonly hasPin: boolean
  /** The account linked, or null. */
  readonly accountId: string | null
  /** False when the person holds rights the actor doesn't: the row shows no controls. */
  readonly manageable: boolean
  /** The role the actor would need to manage this person (for the line under the name). */
  readonly neededRole: string | null
}

/** An account of the organisation a person can be linked to. */
export interface StaffAccountView {
  readonly userId: string
  readonly name: string
  readonly email: string
  /** The person it is linked to already, or null. */
  readonly linkedTo: string | null
}

/** A shared device of the venue. */
export interface StaffDeviceView {
  readonly id: string
  readonly name: string
  readonly since: string
  readonly isThisSession: boolean
}

/** Everything the Staff and roles section draws. */
export interface StaffView {
  readonly venueId: string
  readonly venueName: string
  readonly roles: readonly StaffRoleView[]
  readonly people: readonly StaffPersonView[]
  readonly accounts: readonly StaffAccountView[]
  readonly devices: readonly StaffDeviceView[]
  /** What the actor holds: a tick the actor doesn't hold can't be given. */
  readonly held: readonly Permission[]
  /** True for Restro's admin team: it may give any right and never shares a device. */
  readonly operator: boolean
  /** True when this browser is already a shared device. */
  readonly thisBrowserShared: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

/** The accounts of the organisation, by name. */
async function organizationAccounts(
  tenantId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
  const rows = await getAuthDb()
    .select({ userId: authUser.id, name: authUser.name, email: authUser.email })
    .from(authMember)
    .innerJoin(authUser, eq(authUser.id, authMember.userId))
    .where(eq(authMember.organizationId, tenantId))
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The default role that holds everything `needed` does, lowest first, or null if none does. */
function coveringRole(
  needed: readonly Permission[],
  roles: readonly StaffRoleView[],
): string | null {
  for (const kind of DEFAULT_ROLE_KINDS) {
    const role = roles.find((candidate) => candidate.defaultKind === kind)
    if (role !== undefined && needed.every((permission) => role.permissions.includes(permission))) {
      return role.name
    }
  }
  return null
}

/** The section's view from the service read side. */
export async function buildStaffView(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly venueName: string
  readonly settings: StaffSettings
  readonly held: readonly Permission[]
  readonly operator: boolean
  readonly email: string
}): Promise<StaffView> {
  const { settings } = input
  const count = new Map<string, number>()
  for (const person of settings.staff) {
    count.set(person.roleId, (count.get(person.roleId) ?? 0) + 1)
  }
  const roles: StaffRoleView[] = settings.roles.map((role) => ({
    ref: role.id ?? role.defaultKind ?? '',
    name: role.name,
    defaultKind: role.defaultKind,
    readOnly: role.readOnly,
    permissions: role.permissions,
    people: role.id === null ? 0 : (count.get(role.id) ?? 0),
  }))
  const accounts = await organizationAccounts(input.tenantId)
  const linkedTo = new Map<string, string>()
  for (const person of settings.staff) {
    if (person.accountUserId !== null) linkedTo.set(person.accountUserId, person.displayName)
  }
  const held = new Set(input.held)
  const people = settings.staff.map((person): StaffPersonView => {
    const role = roles.find((candidate) => candidate.ref === person.roleId)
    const needs = role?.permissions ?? []
    const manageable = input.operator || needs.every((permission) => held.has(permission))
    return {
      id: person.id,
      name: person.displayName,
      roleRef: person.roleId,
      hasPin: person.hasPin,
      accountId: person.accountUserId,
      manageable,
      neededRole: manageable ? null : coveringRole(needs, roles),
    }
  })
  return {
    venueId: input.venueId,
    venueName: input.venueName,
    roles,
    people,
    accounts: accounts.map((account) => ({
      ...account,
      linkedTo: linkedTo.get(account.userId) ?? null,
    })),
    devices: settings.devices.map((device) => ({
      id: device.id,
      name: device.name,
      since: device.createdAt.toISOString(),
      isThisSession: device.isThisSession,
    })),
    held: input.held,
    operator: input.operator,
    thisBrowserShared: settings.devices.some((device) => device.isThisSession),
    email: input.email,
  }
}

/** The section's view for the signed-in person, or null when it can't be read. */
export async function loadStaffView(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly venueName: string
  readonly userId: string
  readonly sessionId: string
  readonly email: string
  readonly held: readonly Permission[]
}): Promise<StaffView | null> {
  const operator = await isOperator(input.userId)
  const read = await readStaffSettings(getPool(), {
    tenantId: input.tenantId,
    venueId: input.venueId,
    actor: operator
      ? { kind: 'operator', userId: input.userId }
      : { kind: 'user', userId: input.userId, sessionId: input.sessionId },
  }).catch(() => null)
  if (read === null || !read.ok) return null
  return buildStaffView({
    tenantId: input.tenantId,
    venueId: input.venueId,
    venueName: input.venueName,
    settings: read.settings,
    held: input.held,
    operator,
    email: input.email,
  })
}
