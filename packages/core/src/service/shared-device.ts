// The person on a shared device (D141 12.11; ticket #324). On a device nobody owns, typing the PIN
// starts that person's own short session on it rather than authorising one action, so a run of
// record work is typed once: the next write takes the person from the device, not from a second
// PIN. The device forgets them once it has been idle for a few minutes, which is how a POS front
// end does it and never cuts somebody off mid-task. There is no second rule counting actions on
// top of the permissions: while the session is there, the person's own role decides, exactly as if
// they had typed the PIN again.
//
// Two columns of `shared_devices` hold it (migration 0047): who, and when they last acted. The
// clock is the person's last write, not the start of the session, so a long run of record work
// never expires under their hands. A person archived since (they left) has no session: the join
// below drops them, and their next PIN finds nobody.

import { sharedDevices, staffMembers } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import type { Provenance } from './context'

/** The read side of a transaction. */
type ReadOnly = Pick<WriteTx, 'select'>

/** The write side of a transaction. */
type WriteOnly = Pick<WriteTx, 'update'>

/**
 * How long a shared device keeps the person after their last write, in seconds. Three minutes: a
 * POS front end returns to its passcode screen after a short idle stretch — Toast's is
 * configurable, Eats365 and Lightspeed sign out on idle, and a POS vendor's own glossary puts the
 * usual setting between one and five minutes. Three is the middle of that range: long enough for a
 * party to be seated and its booking written, short enough that a tablet left on the bar is not
 * somebody's open session. The web app may pass a shorter window, which only its tests do.
 */
export const SHARED_DEVICE_IDLE_SECONDS = 180

/** The person whose session is on the device. */
export interface DevicePerson {
  readonly deviceId: string
  readonly staffMemberId: string
  /** Their name, for the toast that answers their write (D123, RR-58). */
  readonly name: string
}

/**
 * Starts the person's session on the device, or pushes it forward: called when a PIN names them
 * (`identifyStaffByPin`) and again on every write they make (the engine). A device holds one
 * person at a time, so a different PIN takes the device over.
 */
export async function keepDevicePerson(
  tx: WriteOnly,
  input: {
    readonly venueId: string
    /** The device's own session (Better Auth), which is what names the device. */
    readonly sessionId: string
    readonly staffMemberId: string
    readonly at: Date
    readonly provenance: Provenance
  },
): Promise<void> {
  await tx
    .update(sharedDevices)
    .set({
      personStaffMemberId: input.staffMemberId,
      personAt: input.at,
      ...input.provenance,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sharedDevices.sessionId, input.sessionId),
        eq(sharedDevices.venueId, input.venueId),
        isNull(sharedDevices.revokedAt),
      ),
    )
}

/**
 * The person still on the live shared device signed in with `sessionId` at this venue, or null:
 * nobody is on it, the device has been idle longer than the window, the session is no shared
 * device of this venue, or the person has left. The caller may then ask for a PIN.
 */
export async function devicePersonOf(
  tx: ReadOnly,
  input: {
    readonly venueId: string
    readonly sessionId: string
    readonly now: Date
    /** How long an idle device keeps the person; `SHARED_DEVICE_IDLE_SECONDS` by default. */
    readonly idleSeconds?: number
  },
): Promise<DevicePerson | null> {
  const idleSeconds = input.idleSeconds ?? SHARED_DEVICE_IDLE_SECONDS
  const since = new Date(input.now.getTime() - idleSeconds * 1000)
  const [row] = await tx
    .select({
      deviceId: sharedDevices.id,
      staffMemberId: staffMembers.id,
      name: staffMembers.displayName,
    })
    .from(sharedDevices)
    .innerJoin(
      staffMembers,
      and(
        eq(staffMembers.tenantId, sharedDevices.tenantId),
        eq(staffMembers.id, sharedDevices.personStaffMemberId),
      ),
    )
    .where(
      and(
        eq(sharedDevices.sessionId, input.sessionId),
        eq(sharedDevices.venueId, input.venueId),
        isNull(sharedDevices.revokedAt),
        isNull(staffMembers.archivedAt),
        gt(sharedDevices.personAt, since),
      ),
    )
  return row ?? null
}
