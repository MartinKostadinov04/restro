'use server'

// The reads of Venue › Reservations that the browser asks again (#326): the night's list, which
// keeps itself current while the night is on, and one reservation's sheet. Read-only server
// actions: each checks its input with Zod, finds who is asking (`requireTenant`: the tenant is the
// person's organisation, never the request's) and that the venue is theirs, then reads as that
// signed-in account; the service read side checks `reservations.tonight` again.
import { idSchema } from '@restro/core'
import { z } from 'zod'

import { logError } from '../log'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import { loadReservationDetail, loadReservationNight, type RvScope } from './load'
import type { RvDetailView, RvFrame, RvNightView } from './view'

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
