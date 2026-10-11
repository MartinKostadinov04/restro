// setGuestFeatures(): the writer for the guest services a venue switches on (D71, brief SH-01 §9),
// `venues.settings.guest_features` = {filters, call_waiter: {enabled, kinds}, bill, ordering, pay}.
// Rule 1 keeps every write of the venue's data in core/apply; the composer's "Guest features"
// panel (SH-05b) calls this and nothing else. A switch here only says what the venue wants: a
// guest sees a service only when the platform supports it, the channel is interactive and a table
// is confirmed too (D71, the shell's R15). The change reaches guests with the next publish.

import { type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import {
  canonicalFeatures,
  type GuestFeatures,
  GuestFeaturesSchema,
  readGuestFeatures,
} from '../theme'

/** Why `setGuestFeatures` refused. */
export type GuestFeaturesErrorCode =
  /** The input does not pass its checks; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'

/** Thrown by `setGuestFeatures`. */
export class GuestFeaturesError extends Error {
  override name = 'GuestFeaturesError'
  readonly code: GuestFeaturesErrorCode

  constructor(code: GuestFeaturesErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The services to save, or null to go back to the defaults (filters on, the rest off). */
  features: GuestFeaturesSchema.nullable(),
})

/** What `setGuestFeatures` needs. */
export type SetGuestFeaturesInput = z.input<typeof InputSchema>

/**
 * Saves the venue's guest services (or removes them with `features: null`) and returns what now
 * applies (the defaults after a removal). The request kinds are stored in the vocabulary's order.
 * Other keys of `venues.settings` are left alone. Idempotent.
 */
export async function setGuestFeatures(
  pool: DbPool,
  tenantId: string,
  input: SetGuestFeaturesInput,
): Promise<GuestFeatures> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) throw new GuestFeaturesError('invalid_input', z.prettifyError(parsed.error))
  const { venueId } = parsed.data
  const features = parsed.data.features === null ? null : canonicalFeatures(parsed.data.features)

  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for('update')
    if (venue === undefined) {
      throw new GuestFeaturesError('venue_not_found', `this tenant has no venue ${venueId}`)
    }
    const { guest_features: _previous, ...others } = venue.settings
    const settings = features === null ? others : { ...others, guest_features: features }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readGuestFeatures(settings)
  })
}
