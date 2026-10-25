// Who is at a shared device (D122 §7; design §5): on a shared device every staff write asks the
// person's own PIN, and the person it names acts, with their own role. The web app calls
// `identifyStaffByPin` before it hands the staff write to `applyService` with a `staff` actor.
// - The session must be a live shared device of the venue; elsewhere a PIN means nothing.
// - The PIN is looked up by `HMAC(pepper, tenant ‖ pin)`, unique in the organisation.
// - A wrong PIN counts against the device (`PinGuard`, in the web process's memory); the fifth in
//   five minutes makes the device wait and writes a `guard.tripped` entry, kept 18 months.
// Nothing here logs or returns a PIN or its HMAC.

import { type DbPool, sharedDevices, staffMembers, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, isNull } from 'drizzle-orm'
import type { PinGuard } from '../pin-guard'
import { STAFF_PIN_PATTERN } from '../seal/staff-pin'
import { serviceDate } from '../service-day'
import { actorText } from './context'
import { appendLogEntry } from './log'
import { pinHmac } from './pins'

/** What a PIN on a shared device found. */
export type PinIdentity =
  | { readonly ok: true; readonly staffMemberId: string; readonly deviceId: string }
  | { readonly ok: false; readonly code: 'not_shared_device' | 'pin_wrong' }
  | { readonly ok: false; readonly code: 'device_waiting'; readonly retryAfterSeconds: number }

/** The person a PIN names on the shared device signed in with `sessionId`. */
export async function identifyStaffByPin(
  pool: DbPool,
  input: {
    readonly tenantId: string
    readonly venueId: string
    /** The device's account and session (Better Auth ids). */
    readonly userId: string
    readonly sessionId: string
    readonly pin: string
    /** The PIN pepper (`STAFF_PIN_PEPPER`). */
    readonly pepper: string
    /** The process's wrong-PIN counters. */
    readonly guard: PinGuard
    /** The web request's id, for the Log entry's `job_id`. */
    readonly jobId: string
    readonly now?: Date
  },
): Promise<PinIdentity> {
  const now = input.now ?? new Date()
  return withTenantWrite(pool, input.tenantId, async (tx): Promise<PinIdentity> => {
    const [device] = await tx
      .select({ id: sharedDevices.id })
      .from(sharedDevices)
      .where(
        and(
          eq(sharedDevices.sessionId, input.sessionId),
          eq(sharedDevices.venueId, input.venueId),
          isNull(sharedDevices.revokedAt),
        ),
      )
    if (device === undefined) return { ok: false, code: 'not_shared_device' }
    const allowed = input.guard.check(device.id, now)
    if (!allowed.ok) {
      return { ok: false, code: 'device_waiting', retryAfterSeconds: allowed.retryAfterSeconds }
    }

    if (STAFF_PIN_PATTERN.test(input.pin)) {
      const [member] = await tx
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.pinHmac, pinHmac(input.pepper, input.tenantId, input.pin)),
            isNull(staffMembers.archivedAt),
          ),
        )
      if (member !== undefined) {
        input.guard.succeed(device.id)
        return { ok: true, staffMemberId: member.id, deviceId: device.id }
      }
    }

    const failure = input.guard.fail(device.id, now)
    if (!failure.tripped) return { ok: false, code: 'pin_wrong' }
    const [venue] = await tx
      .select({ timezone: venues.timezone, serviceDayEndsAt: venues.serviceDayEndsAt })
      .from(venues)
      .where(eq(venues.id, input.venueId))
    if (venue !== undefined) {
      await appendLogEntry(
        tx,
        {
          tenantId: input.tenantId,
          venueId: input.venueId,
          serviceDate: serviceDate(now, venue.timezone, venue.serviceDayEndsAt),
          provenance: {
            source: 'staff',
            actor: actorText({ kind: 'user', userId: input.userId, sessionId: input.sessionId }),
            jobId: input.jobId,
          },
          via: 'tonight',
        },
        {
          kind: 'guard.tripped',
          reason: 'pin_wrong',
          details: { deviceId: device.id, trip: failure.trip, waitSeconds: failure.waitSeconds },
        },
      )
    }
    return { ok: false, code: 'device_waiting', retryAfterSeconds: failure.waitSeconds }
  })
}
