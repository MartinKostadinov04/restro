// setVenueTheme(): the writer for the venue's look (brief S3-03), `venues.settings.theme` =
// {brand, logo_asset_id}. Rule 1 keeps every write of the venue's data in core/apply, so the
// Appearance card of the Settings tab calls this and nothing else. The palette is never stored:
// the publisher derives it from the brand colour (publish.ts), which is why a change reaches
// guests with the next publish, like any hand edit.
//
// The logo must be a stored image of the same tenant (row-level security hides every other
// tenant's rows, so a foreign asset id is simply "not usable"). Its variant files may still be
// in the making; the publisher leaves a logo without them out until they exist.

import { assets, type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { readVenueTheme, type VenueTheme, VenueThemeSchema } from '../theme'

/** Why `setVenueTheme` refused. */
export type VenueThemeErrorCode =
  /** The input does not pass its checks; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The logo is not a stored image of this tenant. */
  | 'logo_not_usable'

/** Thrown by `setVenueTheme`. */
export class VenueThemeError extends Error {
  override name = 'VenueThemeError'
  readonly code: VenueThemeErrorCode

  constructor(code: VenueThemeErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The look to save, or null to go back to the default theme. */
  theme: VenueThemeSchema.nullable(),
})

/** What `setVenueTheme` needs. */
export type SetVenueThemeInput = z.input<typeof InputSchema>

/**
 * Saves the venue's theme (or removes it with `theme: null`) and returns what is stored. Other
 * keys of `venues.settings` are left alone. Idempotent: the same theme changes nothing visible.
 */
export async function setVenueTheme(
  pool: DbPool,
  tenantId: string,
  input: SetVenueThemeInput,
): Promise<VenueTheme | null> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) throw new VenueThemeError('invalid_input', z.prettifyError(parsed.error))
  const { venueId, theme } = parsed.data

  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for('update')
    if (venue === undefined) {
      throw new VenueThemeError('venue_not_found', `this tenant has no venue ${venueId}`)
    }

    if (theme?.logo_asset_id) {
      const [logo] = await tx.select().from(assets).where(eq(assets.id, theme.logo_asset_id))
      if (logo === undefined || logo.status !== 'stored' || logo.width === null) {
        throw new VenueThemeError(
          'logo_not_usable',
          `${theme.logo_asset_id} is not a stored image of this tenant`,
        )
      }
    }

    const { theme: _previous, ...others } = venue.settings
    const settings = theme === null ? others : { ...others, theme }
    await tx.update(venues).set({ settings }).where(eq(venues.id, venueId))
    return readVenueTheme(settings)
  })
}
