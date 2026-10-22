// setOrderingSettings(): the writer of a venue's ordering settings, `venues.settings.ordering`
// (spec #64 Implementation Decisions 3; ticket #66). Rule 1 keeps every write of the venue's data
// in core/apply; the owner's settings screens (#85) call this and nothing else. The Log's `record`
// entry for the change is written beside it on the service path (D122 §7).

import { type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import {
  type OrderingSettings,
  OrderingSettingsSchema,
  readOrderingSettings,
  serviceHoursProblem,
  WEEKDAYS,
} from '../ordering-settings'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `setOrderingSettings` refused. */
export type OrderingSettingsErrorCode =
  /** The input does not pass its checks; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'

/** Thrown by `setOrderingSettings`. */
export class OrderingSettingsError extends Error {
  override name = 'OrderingSettingsError'
  readonly code: OrderingSettingsErrorCode

  constructor(code: OrderingSettingsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The settings to save, or null to go back to the defaults. */
  settings: OrderingSettingsSchema.nullable(),
})

/** What `setOrderingSettings` needs. */
export type SetOrderingSettingsInput = z.input<typeof InputSchema>

/**
 * Saves the venue's ordering settings (or removes them with `settings: null`) and returns what now
 * applies. Service hours are checked against the venue's service day. Other keys of
 * `venues.settings` are left alone. Idempotent.
 */
export async function setOrderingSettings(
  pool: DbPool,
  tenantId: string,
  input: SetOrderingSettingsInput,
): Promise<OrderingSettings> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    throw new OrderingSettingsError('invalid_input', z.prettifyError(parsed.error))
  }
  const { venueId, settings: ordering } = parsed.data

  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new OrderingSettingsError(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
        venueRefusalText(venueId, locked.refused),
      )
    }
    if (ordering !== null) {
      for (const day of WEEKDAYS) {
        const hours = ordering.serviceHours[day]
        const problem =
          hours === null ? null : serviceHoursProblem(hours, locked.venue.serviceDayEndsAt)
        if (problem !== null) throw new OrderingSettingsError('invalid_input', `${day}: ${problem}`)
      }
    }
    const { ordering: _previous, ...others } = locked.venue.settings
    const settings = ordering === null ? others : { ...others, ordering }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readOrderingSettings(settings)
  })
}
