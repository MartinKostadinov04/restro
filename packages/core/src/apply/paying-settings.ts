// setPayingSettings(): the writer of a venue's paying settings, `venues.settings.paying` (D127;
// ticket #104). Rule 1 keeps every write of the venue's data in core/apply; the owner's paying
// screen calls this and nothing else.

import { type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { type PayingSettings, PayingSettingsSchema, readPayingSettings } from '../paying-settings'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `setPayingSettings` refused. */
export type PayingSettingsErrorCode =
  /** The input does not pass its checks, or sits below the provider's minimum; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'

/** Thrown by `setPayingSettings`. */
export class PayingSettingsError extends Error {
  override name = 'PayingSettingsError'
  readonly code: PayingSettingsErrorCode

  constructor(code: PayingSettingsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The settings to save, or null to go back to the defaults. */
  settings: PayingSettingsSchema.nullable(),
  /** The provider's smallest card payment for the venue's currency, in minor units. */
  providerMinMinor: z.number().int().nonnegative(),
})

/** What `setPayingSettings` needs. */
export type SetPayingSettingsInput = z.input<typeof InputSchema>

/**
 * Saves the venue's paying settings (or removes them with `settings: null`) and returns what now
 * applies. Refuses a smallest card payment below the provider's minimum (D127). Other keys of
 * `venues.settings` are left alone. Idempotent.
 */
export async function setPayingSettings(
  pool: DbPool,
  tenantId: string,
  input: SetPayingSettingsInput,
): Promise<PayingSettings> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    throw new PayingSettingsError('invalid_input', z.prettifyError(parsed.error))
  }
  const { venueId, settings: paying, providerMinMinor } = parsed.data
  const minCardMinor = paying?.minCardMinor ?? null
  if (minCardMinor !== null && minCardMinor < providerMinMinor) {
    throw new PayingSettingsError(
      'invalid_input',
      `the smallest card payment must be at least the provider's minimum (${providerMinMinor})`,
    )
  }

  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new PayingSettingsError(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
        venueRefusalText(venueId, locked.refused),
      )
    }
    const { paying: _previous, ...others } = locked.venue.settings
    const settings = paying === null ? others : { ...others, paying }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readPayingSettings(settings)
  })
}
