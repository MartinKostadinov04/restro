// The Appearance card's server side (brief S3-03): what the Settings tab shows of the venue's look,
// and saving it. The saving is `setVenueTheme` in core/apply (rule 1); this file only decides who
// may ask (owners and admins, like the Integration tab) and shapes the answer.
//
// The logo's picture in the card is a signed link to the stored original, like the photos of the
// item sheet; guests never see it, they get the webp variants through the snapshot.
import type { AssetStore } from '@restro/assets'
import { readVenueTheme, VenueThemeSchema } from '@restro/core'
import { setVenueTheme, VenueThemeError } from '@restro/core/apply'
import { assets, type DbPool, type Venue, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import { logError } from '../log'

/** What the card shows. */
export interface AppearanceView {
  /** The saved brand colour, or null when the venue has not chosen one (the default look). */
  readonly brand: string | null
  readonly logo: {
    readonly assetId: string
    /** A signed link to the stored original, or null when it cannot be made. */
    readonly url: string | null
    readonly width: number
    readonly height: number
  } | null
}

export type AppearanceError = 'invalid' | 'forbidden' | 'not_found' | 'logo_not_usable' | 'failed'

/** What a save answers. */
export type AppearanceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AppearanceError }

/** The link lifetime for the card (the admin page is open for minutes, not hours). */
const LINK_SECONDS = 60 * 60

/** Reads the venue's saved look and the link of its logo. */
export async function loadAppearance(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'settings'>,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
): Promise<AppearanceView> {
  const theme = readVenueTheme(venue.settings)
  if (theme === null) return { brand: null, logo: null }
  // Since SH-01 the brand colour is optional (a theme may hold three colours instead).
  const brand = theme.brand ?? null
  if (theme.logo_asset_id === null) return { brand, logo: null }
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select()
      .from(assets)
      .where(eq(assets.id, theme.logo_asset_id as string)),
  )
  if (row === undefined || row.status !== 'stored') return { brand, logo: null }
  let url: string | null = null
  try {
    url = row.storageKey ? await (await store()).getUrl(row.storageKey, LINK_SECONDS) : null
  } catch (error) {
    logError('appearance_logo_url_failed', error)
  }
  return {
    brand,
    logo: { assetId: row.id, url, width: row.width ?? 0, height: row.height ?? 0 },
  }
}

/** Saves the look of a venue. The caller has checked the venue is the person's and their role. */
export async function saveAppearance(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly brand: string; readonly logoAssetId: string | null },
): Promise<AppearanceResult> {
  const theme = VenueThemeSchema.safeParse({ brand: input.brand, logo_asset_id: input.logoAssetId })
  if (!theme.success) return { ok: false, error: 'invalid' }
  try {
    await setVenueTheme(pool, tenantId, { venueId: input.venueId as never, theme: theme.data })
    return { ok: true }
  } catch (error) {
    if (error instanceof VenueThemeError) {
      if (error.code === 'logo_not_usable') return { ok: false, error: 'logo_not_usable' }
      if (error.code === 'venue_not_found') return { ok: false, error: 'not_found' }
      return { ok: false, error: 'invalid' }
    }
    throw error
  }
}
