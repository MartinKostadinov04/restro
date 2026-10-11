// setVenueTheme(): the writer for the venue's look (briefs S3-03 and SH-01), `venues.settings.theme`
// = {brand, logo_asset_id} plus, since SH-01, the three colours, role overrides, font, corners,
// shadow and light/dark policy. Rule 1 keeps every write of the venue's data in core/apply, so the
// admin's look editor calls this and nothing else. Palette and roles are never stored: the
// publisher derives them (publish.ts), which is why a change reaches guests with the next publish,
// like any hand edit.
//
// The logo must be a stored image of the same tenant (row-level security hides every other
// tenant's rows, so a foreign asset id is simply "not usable"). Its variant files may still be
// in the making; the publisher leaves a logo without them out until they exist.
//
// A theme whose roles do not read (an override below 4.5:1 on what it sits on) is refused with
// `unreadable`, naming the pairs: derived roles always read, so only an override can fail.

import { assets, type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import {
  type PairIssue,
  readVenueTheme,
  themeRolesOf,
  type VenueTheme,
  VenueThemeSchema,
  validateRoles,
} from '../theme'

/** Why `setVenueTheme` refused. */
export type VenueThemeErrorCode =
  /** The input does not pass its checks (an unknown font, a radius or shadow out of range …). */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The logo is not a stored image of this tenant. */
  | 'logo_not_usable'
  /** Some text-on-colour pair would not read (`issues` lists them); nothing was written. */
  | 'unreadable'

/** Thrown by `setVenueTheme`. */
export class VenueThemeError extends Error {
  override name = 'VenueThemeError'
  readonly code: VenueThemeErrorCode
  /** The pairs that do not read (`unreadable` only). */
  readonly issues: readonly PairIssue[]

  constructor(code: VenueThemeErrorCode, message: string, issues: readonly PairIssue[] = []) {
    super(message)
    this.code = code
    this.issues = issues
  }
}

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  /** The look to save, or null to go back to the default theme. */
  theme: VenueThemeSchema.nullable(),
})

/** What `setVenueTheme` needs. */
export type SetVenueThemeInput = z.input<typeof InputSchema>

/** One failing pair in words: `light text on surface 3.21:1 (needs 4.5:1)`. */
function describeIssue(issue: PairIssue): string {
  return `${issue.mode} ${issue.fg} on ${issue.bg} ${issue.ratio}:1 (needs ${issue.min}:1)`
}

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

  if (theme !== null) {
    const issues = validateRoles(themeRolesOf(theme))
    if (issues.length > 0) {
      throw new VenueThemeError(
        'unreadable',
        `these colours do not read: ${issues.map(describeIssue).join('; ')}`,
        issues,
      )
    }
  }

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
