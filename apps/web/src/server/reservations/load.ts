// The reads of Venue › Reservations (#326), as the signed-in actor, shaped for the screens by
// `view.ts`. Reads only: nothing here writes, and no POS is called (a reservation is Restro's own
// data, D135). The service read side refuses what the actor does not hold, so a night a role may
// not work never gets its data.
import {
  type ReservationAccess,
  readReservationAccess,
  readReservationDetail,
  readReservationNight,
  type ServiceActor,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'
import {
  type RvDetailView,
  type RvFrame,
  type RvNightView,
  rvDetailView,
  rvFrameOf,
  rvNightView,
} from './view'

/** Who is asking, for which venue. */
export interface RvScope {
  readonly tenantId: string
  readonly venue: Pick<Venue, 'id' | 'timezone'>
  readonly actor: ServiceActor
  readonly now?: Date
}

/** Why a read was refused, or that it failed: the screen shows its own block. */
export type RvResult<T> =
  | ({ readonly ok: true; readonly frame: RvFrame } & T)
  | { readonly ok: false; readonly code: string }

const inputOf = (scope: RvScope) => ({
  tenantId: scope.tenantId,
  venueId: scope.venue.id,
  actor: scope.actor,
  ...(scope.now === undefined ? {} : { now: scope.now }),
})

/** What the actor holds here, without reading a night: the tab bar asks only this. */
export async function loadReservationAccess(
  scope: RvScope,
): Promise<RvResult<{ access: ReservationAccess }>> {
  const read = await readReservationAccess(getPool(), inputOf(scope))
  if (!read.ok) return read
  return { ok: true, access: read.access, frame: rvFrameOf(read.access, scope.venue.id) }
}

/**
 * Whether the venue page offers the Reservations tab at all: the person works tonight's
 * reservations (D141). A role without the key is not shown a tab it cannot open.
 */
export async function reservationsOffered(input: {
  readonly tenantId: string
  readonly venueId: string
  readonly userId: string
  readonly sessionId: string
}): Promise<boolean> {
  const read = await readReservationAccess(getPool(), {
    tenantId: input.tenantId,
    venueId: input.venueId,
    actor: { kind: 'user', userId: input.userId, sessionId: input.sessionId },
  })
  return read.ok
}

/** One night's list, in arrival order (D135), with the nights that hold something. */
export async function loadReservationNight(
  scope: RvScope,
  query: { readonly day?: string },
): Promise<RvResult<{ night: RvNightView }>> {
  const read = await readReservationNight(getPool(), { ...inputOf(scope), ...query })
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    night: rvNightView(read.night, read.access.venue.timezone),
  }
}

/** One reservation for its sheet; null `detail` when the venue has no such line. */
export async function loadReservationDetail(
  scope: RvScope,
  reservationId: string,
): Promise<RvResult<{ detail: RvDetailView | null }>> {
  const read = await readReservationDetail(getPool(), { ...inputOf(scope), reservationId })
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    detail: read.detail === null ? null : rvDetailView(read.detail, read.access.venue.timezone),
  }
}
