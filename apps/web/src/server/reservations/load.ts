// The reads of Venue › Reservations (#326), as the signed-in actor, shaped for the screens by
// `view.ts`. Reads only: nothing here writes, and no POS is called (a reservation is Restro's own
// data, D135). The service read side refuses what the actor does not hold, so a night a role may
// not work never gets its data.
import {
  type BookingChecksInput,
  type ReservationAccess,
  readBookingChecks,
  readFloorPlan,
  readGuestCard,
  readGuestList,
  readGuestSuggestions,
  readReservationAccess,
  readReservationDetail,
  readReservationNight,
  readSpotHistory,
  type ServiceActor,
} from '@restro/core/service'
import type { Venue } from '@restro/db'

import { getPool } from '../db'
import {
  type RvChecksView,
  type RvDetailView,
  type RvFrame,
  type RvGuestCardView,
  type RvGuestListView,
  type RvNightView,
  type RvPlanView,
  type RvSpotHistoryList,
  rvChecksView,
  rvDetailView,
  rvFrameOf,
  rvGuestCardView,
  rvGuestListView,
  rvNightView,
  rvPlanView,
  rvSpotHistoryView,
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

/**
 * One plan of one night (#327): its spots with the state each reads as, the venue's own kinds for
 * the legend and the filter, and what holds every spot. A night that has passed is readable a month
 * back (D141, 9.21); an older one comes back as `tooOld` with nothing in it.
 */
export async function loadFloorPlan(
  scope: RvScope,
  query: { readonly day?: string; readonly planId?: string },
): Promise<RvResult<{ plan: RvPlanView }>> {
  const read = await readFloorPlan(getPool(), { ...inputOf(scope), ...query })
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    plan: rvPlanView(read.plan, read.access.venue.timezone),
  }
}

/** One spot's history from the one Log (D141); `spot` is null when the venue has no such spot. */
export async function loadSpotHistory(
  scope: RvScope,
  spotId: string,
): Promise<RvResult<{ history: RvSpotHistoryList }>> {
  const read = await readSpotHistory(getPool(), { ...inputOf(scope), spotId })
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    history: rvSpotHistoryView(read.spot, read.history, read.access.venue.timezone),
  }
}

/** What the booking form is told about the booking as it stands (#328): warnings, and what would be refused. */
export async function loadBookingChecks(
  scope: RvScope,
  query: Omit<BookingChecksInput, 'tenantId' | 'venueId' | 'actor' | 'now'>,
): Promise<
  | { readonly ok: true; readonly checks: RvChecksView }
  | { readonly ok: false; readonly code: string }
> {
  const read = await readBookingChecks(getPool(), { ...inputOf(scope), ...query })
  if (!read.ok) return read
  return { ok: true, checks: rvChecksView(read.checks, scope.venue.timezone) }
}

// ───────────────────────────────── guests and regulars (#333) ─────────────────────────────────

/** The venue's list of guests, as the actor reads it (their own private list marked, nobody else's). */
export async function loadGuestList(scope: RvScope): Promise<RvResult<{ guests: RvGuestListView }>> {
  const read = await readGuestList(getPool(), inputOf(scope))
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    guests: rvGuestListView(read.list),
  }
}

/** One guest's card; null `card` when the venue has no such guest, or he was erased. */
export async function loadGuestCard(
  scope: RvScope,
  guestId: string,
): Promise<RvResult<{ card: RvGuestCardView | null }>> {
  const read = await readGuestCard(getPool(), { ...inputOf(scope), guestId })
  if (!read.ok) return read
  return {
    ok: true,
    frame: rvFrameOf(read.access, scope.venue.id),
    card: read.card === null ? null : rvGuestCardView(read.card, read.access.venue.timezone),
  }
}

/** The regulars a typed name suggests in the booking form (D140: three letters). */
export async function loadGuestSuggestions(
  scope: RvScope,
  query: string,
): Promise<
  | {
      readonly ok: true
      readonly suggestions: readonly {
        readonly id: string
        readonly name: string | null
        readonly phone: string | null
      }[]
    }
  | { readonly ok: false; readonly code: string }
> {
  return readGuestSuggestions(getPool(), { ...inputOf(scope), query })
}
