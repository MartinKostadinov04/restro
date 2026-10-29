// setPayingSettings(): the writer of a venue's paying settings, `venues.settings.paying` (D127;
// ticket #104). Rule 1 keeps every write of the venue's data in core/apply; the owner's paying
// screen calls this and nothing else.

import { type DbPool, venues } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { type LegalDetails, LegalDetailsSchema, readLegalDetails } from '../legal-details'
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

/** What the owner's Paying screen changes: a key left out stays. */
export interface PayingPatch {
  /** The smallest card payment, or null for the provider's own minimum. */
  readonly minCardMinor?: number | null
  /** The venue's legal details (#198), or null to clear them. */
  readonly legalDetails?: LegalDetails | null
}

/** What `patchPayingSettingsIn` changed. */
export interface PayingPatched {
  /** The keys whose value changed (`minCardMinor`, `legalDetails`). */
  readonly changed: readonly (keyof PayingPatch)[]
}

/**
 * Changes some of the owner's paying choices inside the caller's transaction, under the venue's
 * row lock: the smallest card payment (`venues.settings.paying`, never below the provider's
 * minimum, `providerMinMinor`) and the legal details (`venues.settings.legalDetails`). The service
 * write path's `settings.paying_set` calls it and writes the Log entry beside it; nothing else
 * does. Throws `PayingSettingsError` for a value that does not pass its checks or a venue that is
 * gone; nothing is written then.
 */
export async function patchPayingSettingsIn(
  tx: WriteTx,
  venueId: string,
  patch: PayingPatch,
  providerMinMinor: number,
): Promise<PayingPatched> {
  const locked = await lockLiveVenue(tx, venueId, 'update')
  if (locked.refused !== null) {
    throw new PayingSettingsError(
      locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
      venueRefusalText(venueId, locked.refused),
    )
  }
  const { settings } = locked.venue
  const changed: (keyof PayingPatch)[] = []
  const next: Record<string, unknown> = { ...settings }

  if (patch.minCardMinor !== undefined) {
    const paying = PayingSettingsSchema.safeParse({ minCardMinor: patch.minCardMinor })
    if (!paying.success)
      throw new PayingSettingsError('invalid_input', z.prettifyError(paying.error))
    if (paying.data.minCardMinor !== null && paying.data.minCardMinor < providerMinMinor) {
      throw new PayingSettingsError(
        'invalid_input',
        `the smallest card payment must be at least the provider's minimum (${providerMinMinor})`,
      )
    }
    if (paying.data.minCardMinor !== readPayingSettings(settings).minCardMinor) {
      changed.push('minCardMinor')
      if (paying.data.minCardMinor === null) delete next.paying
      else next.paying = paying.data
    }
  }

  if (patch.legalDetails !== undefined) {
    const legal =
      patch.legalDetails === null ? null : LegalDetailsSchema.safeParse(patch.legalDetails)
    if (legal !== null && !legal.success) {
      throw new PayingSettingsError('invalid_input', z.prettifyError(legal.error))
    }
    const after = legal === null ? null : legal.data
    if (JSON.stringify(after) !== JSON.stringify(readLegalDetails(settings))) {
      changed.push('legalDetails')
      if (after === null) delete next.legalDetails
      else next.legalDetails = after
    }
  }

  if (changed.length > 0)
    await tx.update(venues).set({ settings: next }).where(eq(venues.id, venueId))
  return { changed }
}
