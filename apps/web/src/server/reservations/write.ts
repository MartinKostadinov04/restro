// The writes of Venue › Reservations (#327: blocking a spot and lifting a block; #328: taking,
// changing, calling off, taking out, bringing back and copying a booking, and a no-show), server side.
// Every write is the service write path's (`applyService`, rule 1), which checks the permission
// inside its own transaction (`reservations.block`) and appends the Log entry; this file only says
// who is asking and shapes the answer. No POS is called: a reservation is Restro's own data (D134).
//
// Who acts (D141, ticket #324): the signed-in account, or — on a shared device — the person whose
// PIN came with the action, or with no PIN the person whose own short session is still on the
// device. Blocking is not quick work on a shared device, so the PIN falls on it: a screen that
// cannot name a person is answered `pin_required` and asks for one, rather than telling a hostess
// at the tablet that she may not.
//
// `via` is left to the engine's own default for a staff command, because the Log's `via` list has
// no value for the reservations screens yet (the report's open question).
import { newId } from '@restro/core'
import {
  applyService,
  type RefusalCode,
  type ServiceActor,
  type ServiceResult,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'
import { logError } from '../log'
import { requireTenant } from '../session'
import { identifyAtSharedDevice, ownActor, personAtSharedDevice } from '../staff/service'
import { getVenue } from '../venues'

/** A command the reservations screens send; the venue is the scope's. */
export type RvCommand =
  | {
      readonly type: 'block.save'
      readonly reservationId?: string
      readonly serviceDate: string
      readonly startsAt: string
      readonly endsAt?: string | null
      readonly spotIds: readonly string[]
      readonly reason?: string | null
    }
  | { readonly type: 'block.remove'; readonly reservationId: string; readonly reason?: string }
  | {
      readonly type: 'reservation.create'
      readonly serviceDate: string
      readonly startsAt: string
      readonly endsAt?: string | null
      readonly kind: 'booking'
      readonly status: 'reserved'
      readonly partySize: number
      readonly note?: string | null
      readonly reason?: string | null
      readonly spotIds: readonly string[]
      /** With a number the name is the guest's (the record holds it); without, the booking's. */
      readonly phone?: string
      readonly guestName?: string
      readonly partyLabel?: string
    }
  | {
      readonly type: 'reservation.edit'
      readonly reservationId: string
      /** The version the form was opened on: another one is refused `reservation_stale`. */
      readonly expectedVersion?: string
      readonly startsAt?: string
      readonly endsAt?: string | null
      readonly partySize?: number
      readonly note?: string | null
      readonly reason?: string | null
      readonly name?: string
      readonly phone?: string | null
      readonly spotIds?: readonly string[]
    }
  | { readonly type: 'reservation.cancel'; readonly reservationId: string }
  | { readonly type: 'reservation.delete'; readonly reservationId: string }
  | { readonly type: 'reservation.restore'; readonly reservationId: string }
  | {
      readonly type: 'reservation.copy'
      readonly reservationId: string
      readonly serviceDate: string
      readonly startsAt: string
      readonly endsAt?: string | null
      readonly spotIds?: readonly string[]
    }
  | {
      readonly type: 'reservation.set_status'
      readonly reservationId: string
      readonly status: 'no_show'
    }
  | { readonly type: 'reservation.put_back'; readonly reservationId: string }

/** Why a PIN did not name a person (`identifyStaffByPin`'s codes). */
export type RvPinRefusal = 'not_shared_device' | 'pin_wrong' | 'device_waiting'

/** What a reservations write answers. */
export type RvWriteResult =
  | {
      readonly ok: true
      /** The service path's details: the reservation the write made or changed. */
      readonly details: Extract<ServiceResult, { status: 'accepted' }>['details']
      /** Whom the PIN named, for the toast ("· {who}"). */
      readonly who?: string
    }
  | {
      readonly ok: false
      /** The service path's refusal code, a PIN's, `invalid`, `venue_missing` or `failed`. */
      readonly error:
        | RefusalCode
        | RvPinRefusal
        | 'pin_required'
        | 'invalid'
        | 'failed'
        | (string & {})
      /** For `device_waiting`: how long the device waits before the next PIN. */
      readonly retryAfterSeconds?: number
      /** What the refusal says beside its code: the party in the way, and the spot. */
      readonly details?: Extract<ServiceResult, { status: 'refused' }>['details']
    }

/** The venue a command is built against: its clock decides the night a block falls on (D45). */
export type RvWriteVenue = Pick<Venue, 'id' | 'timezone' | 'serviceDayEndsAt'>

/** What a write needs of the request: the venue, and a PIN where a shared device asks for one. */
export interface RvWriteInput {
  readonly venueId: string
  readonly pin?: string | undefined
}

const INVALID: RvWriteResult = { ok: false, error: 'invalid' }
const NOT_FOUND: RvWriteResult = { ok: false, error: 'venue_missing' }

/** The invalid answer, so an action's Zod failure reads the same everywhere. */
export const invalidWrite = (): RvWriteResult => INVALID

function answer(result: ServiceResult, who: string | null): RvWriteResult {
  if (result.status === 'accepted') {
    return who === null
      ? { ok: true, details: result.details }
      : { ok: true, details: result.details, who }
  }
  return {
    ok: false,
    error: result.code,
    ...(Object.keys(result.details).length === 0 ? {} : { details: result.details }),
  }
}

/**
 * Runs one reservations command for a venue of the signed-in person's organisation, as the account
 * or as the person a PIN names. The tenant is the person's organisation, never the request's, and
 * another tenant's venue comes back as `venue_missing` (row-level security).
 */
export async function performReservationWrite(
  input: RvWriteInput,
  command: RvCommand | ((venue: RvWriteVenue) => RvCommand),
): Promise<RvWriteResult> {
  try {
    const { organization, user, sessionId, signedInAt } = await requireTenant()
    const venue = await getVenue(organization.id, input.venueId)
    if (!venue) return NOT_FOUND
    let actor: ServiceActor = await ownActor(user, sessionId)
    let named: string | null = null
    /** True when the person acting is the one the device remembers, not a PIN typed just now. */
    let fromSession = false
    if (input.pin !== undefined) {
      const identity = await identifyAtSharedDevice({
        tenantId: organization.id,
        venueId: venue.id,
        userId: user.id,
        sessionId,
        pin: input.pin,
      })
      if (!identity.ok) {
        return identity.code === 'device_waiting'
          ? { ok: false, error: identity.code, retryAfterSeconds: identity.retryAfterSeconds }
          : { ok: false, error: identity.code }
      }
      actor = { kind: 'staff', staffMemberId: identity.staffMemberId, sessionId }
      named = identity.name
    } else {
      const person = await personAtSharedDevice({
        tenantId: organization.id,
        venueId: venue.id,
        sessionId,
      })
      if (person !== null) {
        actor = { kind: 'staff', staffMemberId: person.staffMemberId, sessionId }
        named = person.name
        fromSession = true
      }
    }
    const { result } = await applyService(
      getPool(),
      typeof command === 'function' ? command(venue) : command,
      {
        tenantId: organization.id,
        venueId: venue.id,
        origin: 'staff',
        actor,
        jobId: newId('jb'),
        ...(signedInAt === undefined ? {} : { signedInAt }),
      },
    )
    // The person the device remembers may not block: the screen asks for a PIN, so whoever may can
    // type theirs, instead of the tablet saying no to somebody who never asked (D141, #324). A PIN
    // typed for this very action keeps its own refusal.
    if (result.status === 'refused' && fromSession && result.code === 'permission_denied') {
      return { ok: false, error: 'pin_required' }
    }
    return answer(result, named)
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('reservation_write_failed', error)
    return { ok: false, error: 'failed' }
  }
}
