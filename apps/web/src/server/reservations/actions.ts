'use server'

// The actions of Venue › Reservations that the browser calls: the night's list, which keeps itself
// current while the night is on, one reservation's sheet, the floor plan with one spot's history
// (#327), and the two writes the plan offers — block a spot and lift a block. Each one checks its
// input with Zod, finds who is asking (`requireTenant`: the tenant is the person's organisation,
// never the request's) and that the venue is theirs, then reads or writes as that signed-in account
// (or, on a shared device, as the person a PIN names). The service side checks the permission again:
// `reservations.tonight` to read, `reservations.block` to write. A failure is a plain `{ ok: false }`
// with the detail in the log, never on the screen.
import { addDaysToDay, idSchema, localInstant, serviceDate } from '@restro/core'
import { z } from 'zod'

import { BLOCK_REASONS } from '@/reservations/block-reasons'

import { logError } from '../log'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import {
  loadFloorPlan,
  loadReservationDetail,
  loadReservationNight,
  loadSpotHistory,
  type RvScope,
} from './load'
import type { RvDetailView, RvFrame, RvNightView, RvPlanView, RvSpotHistoryList } from './view'
import { invalidWrite, performReservationWrite, type RvWriteResult } from './write'

const venueId = idSchema('vn')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const Night = z.strictObject({ venueId, day: day.optional() })
const One = z.strictObject({ venueId, reservationId: idSchema('rv') })

/** What a read answers: the data and the frame, or that it could not be read. */
export type RvAnswer<T> =
  | ({ readonly ok: true; readonly frame: RvFrame } & T)
  | { readonly ok: false }

const FAILED = { ok: false } as const

/** The scope of the signed-in account for one of its venues, or null. */
async function scopeOf(id: string): Promise<RvScope | null> {
  const { organization, user, sessionId } = await requireTenant()
  const venue = await getVenue(organization.id, id)
  if (!venue) return null
  return {
    tenantId: organization.id,
    venue,
    actor: { kind: 'user', userId: user.id, sessionId },
  }
}

async function answer<T>(
  event: string,
  run: () => Promise<RvAnswer<T> | { readonly ok: false; readonly code: string }>,
): Promise<RvAnswer<T>> {
  try {
    const result = await run()
    return result.ok ? result : FAILED
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(event, error)
    return FAILED
  }
}

/** One night's list of reservations. */
export async function reservationNightAction(
  input: unknown,
): Promise<RvAnswer<{ night: RvNightView }>> {
  const parsed = Night.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, day: asked } = parsed.data
  return answer('reservations_night_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    return loadReservationNight(scope, asked === undefined ? {} : { day: asked })
  })
}

/** One reservation's sheet. */
export async function reservationDetailAction(
  input: unknown,
): Promise<RvAnswer<{ detail: RvDetailView | null }>> {
  const parsed = One.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('reservation_detail_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadReservationDetail(scope, parsed.data.reservationId)
  })
}

// ───────────────────────────────── the floor plan (#327) ─────────────────────────────────

const Plan = z.strictObject({ venueId, day: day.optional(), planId: idSchema('fp').optional() })
const SpotHistory = z.strictObject({ venueId, spotId: idSchema('sp') })

/** One plan on one night: the spots, their states, and what holds them. */
export async function floorPlanAction(input: unknown): Promise<RvAnswer<{ plan: RvPlanView }>> {
  const parsed = Plan.safeParse(input)
  if (!parsed.success) return FAILED
  const { venueId: id, ...query } = parsed.data
  return answer('reservations_plan_failed', async () => {
    const scope = await scopeOf(id)
    if (scope === null) return FAILED
    return loadFloorPlan(scope, query)
  })
}

/** One spot's history, from the one Log (D141). */
export async function spotHistoryAction(
  input: unknown,
): Promise<RvAnswer<{ history: RvSpotHistoryList }>> {
  const parsed = SpotHistory.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('spot_history_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadSpotHistory(scope, parsed.data.spotId)
  })
}

/** A staff member's 4-digit PIN, entered on a shared device (D141). */
const pin = z
  .string()
  .regex(/^\d{4}$/)
  .optional()

const Block = z.strictObject({
  venueId,
  spotId: idSchema('sp'),
  /** Required (D137), and one of the reasons the screen offers. */
  reason: z.enum(BLOCK_REASONS),
  /** The first night of the block; left out, it starts now. */
  from: day.optional(),
  /** The last night of the block; left out, it stays on until somebody lifts it. */
  until: day.optional(),
  pin,
})
const Unblock = z.strictObject({ venueId, reservationId: idSchema('rv'), pin })

/**
 * Takes one spot out of use (D137): a reservation of the block kind on that spot, with its reason.
 * With no dates it begins now and stays on until somebody lifts it; with dates it covers whole
 * nights of the venue's own clock (D45), the last one included. The service write path refuses it
 * where a party is already booked and names them, which the screen's toast reads.
 */
export async function blockSpotAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Block.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, spotId, reason, from, until, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...(typed === undefined ? {} : { pin: typed }) },
    (venue) => {
      const now = new Date()
      const today = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
      const night = from ?? today
      return {
        type: 'block.save',
        serviceDate: night,
        startsAt: (from === undefined
          ? now
          : localInstant(night, venue.serviceDayEndsAt, venue.timezone, venue.serviceDayEndsAt)
        ).toISOString(),
        // The night a block's last day belongs to ends the morning after it (D45).
        endsAt:
          until === undefined
            ? null
            : localInstant(
                addDaysToDay(until, 1),
                venue.serviceDayEndsAt,
                venue.timezone,
                venue.serviceDayEndsAt,
              ).toISOString(),
        spotIds: [spotId],
        reason,
      }
    },
  )
}

/** Puts a blocked spot back: one tap for the same permission (#327). */
export async function unblockSpotAction(input: unknown): Promise<RvWriteResult> {
  const parsed = Unblock.safeParse(input)
  if (!parsed.success) return invalidWrite()
  const { venueId: id, reservationId: block, pin: typed } = parsed.data
  return performReservationWrite(
    { venueId: id, ...(typed === undefined ? {} : { pin: typed }) },
    { type: 'block.remove', reservationId: block, reason: 'block_lifted' },
  )
}
