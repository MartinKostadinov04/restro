'use server'

// The Staff and roles section's server actions (#87): thin wrappers over the #72 staff commands.
// Each checks its input with Zod, finds who is asking and that the venue is theirs (`scope.ts`),
// and calls the service write path, which checks `settings.roles` and the sign-in of the last 15
// minutes again and writes the `record` Log entry. A PIN is drawn by Restro and shown only
// through `pin.reveal` (logged) and the worker's reveal endpoint: the add and new-PIN results
// carry it once, for the screen to show for 30 seconds; nothing here stores or logs it.
import { idSchema } from '@restro/core'
import { DEFAULT_ROLE_KINDS, PERMISSIONS } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { revealConfig, revealPinsFor } from '../reveal'
import { staffServiceOptions } from '../staff/service'
import {
  INVALID,
  inSettingsScope,
  type ResultDetails,
  runSettingsCommand,
  type SettingsResult,
  type SettingsScope,
} from './scope'

const venueId = idSchema('vn')
const staffMemberId = idSchema('sm')
const roleId = idSchema('rl')
const deviceId = idSchema('dv')
/** A role as a command names it: its id, or a default role's kind. */
const roleRef = z.union([roleId, z.enum(DEFAULT_ROLE_KINDS)])
const name = z.string().trim().min(1).max(60)

const OnPerson = z.strictObject({ venueId, staffMemberId })
const AddPerson = z.strictObject({ venueId, displayName: name, roleId: roleRef })
const RenamePerson = z.strictObject({ venueId, staffMemberId, displayName: name })
const AssignRole = z.strictObject({ venueId, staffMemberId, roleId: roleRef })
const LinkAccount = z.strictObject({
  venueId,
  staffMemberId,
  userId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)
    .nullable(),
})
const CopyRole = z.strictObject({
  venueId,
  fromRoleId: roleRef,
  name: z.string().trim().min(1).max(40),
})
const UpdateRole = z.strictObject({
  venueId,
  roleId,
  name: z.string().trim().min(1).max(40).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).optional(),
})
const OnRole = z.strictObject({ venueId, roleId })
const MarkDevice = z.strictObject({ venueId, name: z.string().trim().min(1).max(40) })
const OnDevice = z.strictObject({ venueId, deviceId })

/** A result that may carry a PIN, for the screen to show once. */
export type PinResult =
  | {
      readonly ok: true
      readonly details: ResultDetails
      readonly staffMemberId: string
      readonly pin: string | null
    }
  | { readonly ok: false; readonly error: string }

/** The PIN of one person: `pin.reveal` is logged, then the worker opens the sealed copy. */
async function revealPin(scope: SettingsScope, id: string): Promise<string | null> {
  const accepted = await runSettingsCommand(scope, { type: 'pin.reveal', staffMemberIds: [id] })
  if (!accepted.ok) return null
  const reveal = revealPinsFor(revealConfig(), {
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    actor: {
      userId: scope.userId,
      sessionId: scope.sessionId,
      signedInAt: scope.signedInAt,
      operator: scope.operator,
    },
  })
  return (await reveal([id])).get(id) ?? null
}

/** Runs one command for a venue and refreshes the venue's pages when it was accepted. */
async function change(
  input: { readonly venueId: string },
  command: unknown,
  own = false,
): Promise<SettingsResult> {
  return inSettingsScope(input.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, command, {
      own,
      service: staffServiceOptions(),
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** Adds a person with a role at this venue and a PIN, which the answer carries once. */
export async function addPersonAction(input: unknown): Promise<PinResult> {
  const parsed = AddPerson.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await inSettingsScope(parsed.data.venueId, async (scope) => {
    const added = await runSettingsCommand(
      scope,
      { type: 'staff.add', displayName: parsed.data.displayName, roleId: parsed.data.roleId },
      { service: staffServiceOptions() },
    )
    if (!added.ok) return added
    const id = String(added.details.staffMemberId ?? '')
    revalidatePath(`/venues/${scope.venueId}`)
    return {
      ok: true,
      details: added.details,
      staffMemberId: id,
      pin: await revealPin(scope, id),
    } as const
  })
  return result as PinResult
}

/** Shows a person's PIN again (`pin.reveal`, logged). */
export async function revealPinAction(input: unknown): Promise<PinResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await inSettingsScope(parsed.data.venueId, async (scope) => {
    const pin = await revealPin(scope, parsed.data.staffMemberId)
    return pin === null
      ? ({ ok: false, error: 'pin_unavailable' } as const)
      : ({ ok: true, details: {}, staffMemberId: parsed.data.staffMemberId, pin } as const)
  })
  return result as PinResult
}

/** Gives a person another PIN; the old one stops at once and the new one comes back once. */
export async function newPinAction(input: unknown): Promise<PinResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await inSettingsScope(parsed.data.venueId, async (scope) => {
    const done = await runSettingsCommand(
      scope,
      { type: 'pin.reset', staffMemberId: parsed.data.staffMemberId },
      { service: staffServiceOptions() },
    )
    if (!done.ok) return done
    revalidatePath(`/venues/${scope.venueId}`)
    return {
      ok: true,
      details: done.details,
      staffMemberId: parsed.data.staffMemberId,
      pin: await revealPin(scope, parsed.data.staffMemberId),
    } as const
  })
  return result as PinResult
}

/** Renames a person. */
export async function renamePersonAction(input: unknown): Promise<SettingsResult> {
  const parsed = RenamePerson.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rest } = parsed.data
  return change({ venueId: venue }, { type: 'staff.rename', ...rest })
}

/** Gives a person another role at this venue. */
export async function assignRoleAction(input: unknown): Promise<SettingsResult> {
  const parsed = AssignRole.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rest } = parsed.data
  return change({ venueId: venue }, { type: 'staff.assign', ...rest })
}

/** The person no longer works at this venue (they keep other venues). */
export async function removeFromVenueAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return INVALID
  return change(parsed.data, {
    type: 'staff.unassign',
    staffMemberId: parsed.data.staffMemberId,
  })
}

/** The person leaves the organisation: every venue, and their PIN stops working. */
export async function removeForGoodAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return INVALID
  return change(parsed.data, { type: 'staff.archive', staffMemberId: parsed.data.staffMemberId })
}

/** Links a person to an account of the organisation (their own phone), or unlinks. */
export async function linkAccountAction(input: unknown): Promise<SettingsResult> {
  const parsed = LinkAccount.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rest } = parsed.data
  return change({ venueId: venue }, { type: 'staff.link_account', ...rest })
}

/** Makes a venue's own role from a default role or another of its own. */
export async function copyRoleAction(input: unknown): Promise<SettingsResult> {
  const parsed = CopyRole.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rest } = parsed.data
  return change({ venueId: venue }, { type: 'role.copy', ...rest })
}

/** Renames a venue's own role or changes what it may do. */
export async function updateRoleAction(input: unknown): Promise<SettingsResult> {
  const parsed = UpdateRole.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...rest } = parsed.data
  return change({ venueId: venue }, { type: 'role.update', ...rest })
}

/** Retires a venue's own role nobody holds. */
export async function archiveRoleAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnRole.safeParse(input)
  if (!parsed.success) return INVALID
  return change(parsed.data, { type: 'role.archive', roleId: parsed.data.roleId })
}

/** Makes this browser a shared device (the account's own session, never Restro's admin team). */
export async function markSharedDeviceAction(input: unknown): Promise<SettingsResult> {
  const parsed = MarkDevice.safeParse(input)
  if (!parsed.success) return INVALID
  return change(parsed.data, { type: 'device.mark_shared', name: parsed.data.name }, true)
}

/** Stops a device being shared; done from another session. */
export async function revokeSharedDeviceAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnDevice.safeParse(input)
  if (!parsed.success) return INVALID
  return change(parsed.data, { type: 'device.revoke', deviceId: parsed.data.deviceId })
}
