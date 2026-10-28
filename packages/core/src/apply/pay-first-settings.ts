// setPayFirstSettings(): the writer of a venue's pay-first settings, `venues.settings.payFirst`
// (D113, D122 §5; ticket #113). Rule 1 keeps every write of the venue's data in core/apply; the
// owner's screen (#116) calls this and nothing else.

import { areas, bars, type DbPool, venues, venueTables } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import {
  type PayFirstSettings,
  PayFirstSettingsSchema,
  readPayFirstSettings,
} from '../pay-first-settings'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `setPayFirstSettings` refused. */
export type PayFirstSettingsErrorCode =
  /** The input does not pass its checks, or names a bar, hall or table of another venue. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'

/** Thrown by `setPayFirstSettings`. */
export class PayFirstSettingsError extends Error {
  override name = 'PayFirstSettingsError'
  readonly code: PayFirstSettingsErrorCode

  constructor(code: PayFirstSettingsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The settings to save, or null to go back to the defaults. */
  settings: PayFirstSettingsSchema.nullable(),
})

/** What `setPayFirstSettings` needs. */
export type SetPayFirstSettingsInput = z.input<typeof InputSchema>

/**
 * Saves the venue's pay-first settings (or removes them with `settings: null`) and returns what now
 * applies. Every bar, hall and table named must be the venue's own and not archived. Other keys of
 * `venues.settings` are left alone. Idempotent.
 */
export async function setPayFirstSettings(
  pool: DbPool,
  tenantId: string,
  input: SetPayFirstSettingsInput,
): Promise<PayFirstSettings> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    throw new PayFirstSettingsError('invalid_input', z.prettifyError(parsed.error))
  }
  const { venueId, settings: payFirst } = parsed.data

  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new PayFirstSettingsError(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
        venueRefusalText(venueId, locked.refused),
      )
    }
    if (payFirst !== null) {
      const groupIds = Object.keys(payFirst.groups)
      const barIds = groupIds.filter((id) => id.startsWith('br_'))
      const areaIds = groupIds.filter((id) => id.startsWith('ar_'))
      const tableIds = Object.keys(payFirst.tables)
      const found = [
        ...(barIds.length === 0
          ? []
          : await tx
              .select({ id: bars.id })
              .from(bars)
              .where(
                and(eq(bars.venueId, venueId), inArray(bars.id, barIds), isNull(bars.archivedAt)),
              )),
        ...(areaIds.length === 0
          ? []
          : await tx
              .select({ id: areas.id })
              .from(areas)
              .where(
                and(
                  eq(areas.venueId, venueId),
                  inArray(areas.id, areaIds),
                  isNull(areas.archivedAt),
                ),
              )),
        ...(tableIds.length === 0
          ? []
          : await tx
              .select({ id: venueTables.id })
              .from(venueTables)
              .where(
                and(
                  eq(venueTables.venueId, venueId),
                  inArray(venueTables.id, tableIds),
                  isNull(venueTables.archivedAt),
                ),
              )),
      ].map((row) => row.id)
      const unknown = [...groupIds, ...tableIds].filter((id) => !found.includes(id))
      if (unknown.length > 0) {
        throw new PayFirstSettingsError(
          'invalid_input',
          `not a bar, hall or table of venue ${venueId}: ${unknown.join(', ')}`,
        )
      }
    }
    const { payFirst: _previous, ...others } = locked.venue.settings
    const settings = payFirst === null ? others : { ...others, payFirst }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readPayFirstSettings(settings)
  })
}
