// setVenuePresentation(): the writer for the venue's template (D69, brief SH-01 §9),
// `venues.settings.presentation` = {face, options}. Rule 1 keeps every write of the venue's data
// in core/apply. Core checks the shape only: which faces exist and which options each declares is
// the template registry's, so the admin checks the face and its options against it before saving
// (SH-05a). The change reaches guests with the next publish, like any hand edit.

import { type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { type Presentation, PresentationSchema, readPresentation } from '../theme'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `setVenuePresentation` refused. */
export type VenuePresentationErrorCode =
  /** The input does not pass its checks; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'

/** Thrown by `setVenuePresentation`. */
export class VenuePresentationError extends Error {
  override name = 'VenuePresentationError'
  readonly code: VenuePresentationErrorCode

  constructor(code: VenuePresentationErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The template to save, or null to go back to the registry's default. */
  presentation: PresentationSchema.nullable(),
})

/** What `setVenuePresentation` needs. */
export type SetVenuePresentationInput = z.input<typeof InputSchema>

/**
 * Saves the venue's template and its options (or removes them with `presentation: null`) and
 * returns what is stored. Other keys of `venues.settings` are left alone. Idempotent.
 */
export async function setVenuePresentation(
  pool: DbPool,
  tenantId: string,
  input: SetVenuePresentationInput,
): Promise<Presentation | null> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    throw new VenuePresentationError('invalid_input', z.prettifyError(parsed.error))
  }
  const { venueId, presentation } = parsed.data

  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new VenuePresentationError(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
        venueRefusalText(venueId, locked.refused),
      )
    }
    const { presentation: _previous, ...others } = locked.venue.settings
    const settings = presentation === null ? others : { ...others, presentation }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readPresentation(settings)
  })
}
