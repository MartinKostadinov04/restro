// The Design tab's server side (brief SH-05a): what the tab shows of the venue's look and template,
// and saving them. The writing is `setVenueTheme` and `setVenuePresentation` in core/apply (rule
// 1); this file decides what may be asked of them and shapes the answer. Who may ask (owners and
// admins, like the Integration tab) is the action's check.
//
// Two things that matter here:
//   - A look is always saved WHOLE. The old Appearance card wrote only `{brand, logo_asset_id}`,
//     which would have dropped every v2 field. `FullThemeSchema` refuses a theme without its font,
//     corners, shadow and light/dark policy, so a partial theme cannot reach the database.
//   - A template is checked against the list of manifests before it is saved (core only checks the shape):
//     it must be a VISIBLE entry, and its options go through `resolveOptions` with its manifest.
//     The look options are the form's; the guest-feature options belong to the composer's panel
//     (SH-05b) and are kept as they are.
//
// The logo's picture in the tab is a signed link to the stored original, like the photos of the
// item sheet; guests never see it, they get the webp variants through the snapshot.
import type { AssetStore } from '@restro/assets'
import {
  type PairIssue,
  type Presentation,
  PresentationSchema,
  readPresentation,
  readVenueTheme,
  type VenueTheme,
  VenueThemeSchema,
} from '@restro/core'
import {
  setVenuePresentation,
  setVenueTheme,
  VenuePresentationError,
  VenueThemeError,
} from '@restro/core/apply'
import { assets, type DbPool, type Venue, withTenant } from '@restro/db'

import { eq } from 'drizzle-orm'

import { chooseableFace, mergeOptions } from '@/design/template-options'
import { DEFAULT_FACE_ID } from '@/faces/manifests'

import { logError } from '../log'
import { canManageIntegration } from '../roles'

/** A saved logo as the tab shows it. */
export interface DesignLogo {
  readonly assetId: string
  /** A signed link to the stored original, or null when it cannot be made. */
  readonly url: string | null
  readonly width: number
  readonly height: number
}

/** What the Design tab shows. */
export interface DesignView {
  /** The saved look, or null when the venue has not set one (the default look). */
  readonly theme: VenueTheme | null
  /** The saved template and its options; the registry's default template when none is saved. */
  readonly presentation: Presentation
  readonly logo: DesignLogo | null
  /** Owners and admins edit; everyone else reads. */
  readonly canEdit: boolean
}

/** The link lifetime for the tab (the admin page is open for minutes, not hours). */
const LINK_SECONDS = 60 * 60

/**
 * The venue's logo with a signed link to it: null when it has none, or the asset is not stored.
 * Shared with the table-card print page, which draws the same logo.
 */
export async function loadVenueLogo(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'settings'>,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
): Promise<DesignLogo | null> {
  const theme = readVenueTheme(venue.settings)
  const logoId = theme?.logo_asset_id ?? null
  if (logoId === null) return null
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select().from(assets).where(eq(assets.id, logoId)),
  )
  if (row === undefined || row.status !== 'stored') return null
  let url: string | null = null
  try {
    url = row.storageKey ? await (await store()).getUrl(row.storageKey, LINK_SECONDS) : null
  } catch (error) {
    logError('design_logo_url_failed', error)
  }
  return { assetId: row.id, url, width: row.width ?? 0, height: row.height ?? 0 }
}

/** Reads the venue's saved look and template and the link of its logo. */
export async function loadDesign(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'settings'>,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
  role: string | null | undefined,
): Promise<DesignView> {
  return {
    theme: readVenueTheme(venue.settings),
    presentation: readPresentation(venue.settings) ?? { face: DEFAULT_FACE_ID, options: {} },
    logo: await loadVenueLogo(pool, tenantId, venue, store),
    canEdit: canManageIntegration(role),
  }
}

// --- The look ------------------------------------------------------------------------------------

/**
 * A complete look: the core schema, with the v2 fields the form always sends made required. A
 * look with the three colours also says which preset it started from (or null for custom), and a
 * look is built either from the three colours or from one brand colour, never both.
 */
export const FullThemeSchema = VenueThemeSchema.required({
  font: true,
  radius: true,
  shadow: true,
  scheme: true,
})
  .refine((theme) => theme.colors === undefined || theme.preset !== undefined, {
    message: 'a look with three colours names its preset, or null',
    path: ['preset'],
  })
  .refine((theme) => theme.colors === undefined || theme.brand === undefined, {
    message: 'a look is built from three colours or from a brand colour, not both',
    path: ['brand'],
  })

export type LookError =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'logo_not_usable'
  | 'unreadable'
  | 'failed'

/** What saving a look answers. `unreadable` names the pairs that do not read. */
export type LookResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: Exclude<LookError, 'unreadable'> }
  | { readonly ok: false; readonly error: 'unreadable'; readonly issues: readonly PairIssue[] }

/** Saves the look of a venue. The caller has checked the venue is the person's and their role. */
export async function saveLook(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly theme: unknown },
): Promise<LookResult> {
  const theme = FullThemeSchema.safeParse(input.theme)
  if (!theme.success) return { ok: false, error: 'invalid' }
  try {
    await setVenueTheme(pool, tenantId, { venueId: input.venueId as never, theme: theme.data })
    return { ok: true }
  } catch (error) {
    if (error instanceof VenueThemeError) {
      if (error.code === 'unreadable') {
        return { ok: false, error: 'unreadable', issues: error.issues }
      }
      if (error.code === 'logo_not_usable') return { ok: false, error: 'logo_not_usable' }
      if (error.code === 'venue_not_found') return { ok: false, error: 'not_found' }
      return { ok: false, error: 'invalid' }
    }
    throw error
  }
}

// --- The template --------------------------------------------------------------------------------

export type TemplateError = 'invalid' | 'forbidden' | 'not_found' | 'unknown_face' | 'failed'

/** What choosing a template (or one of its look options) answers. */
export type TemplateResult =
  | { readonly ok: true; readonly presentation: Presentation }
  | { readonly ok: false; readonly error: TemplateError }

/**
 * Saves the template a venue chose and its look options. The caller has checked the venue is the
 * person's and their role; `venue.settings` is the saved presentation the options merge into.
 */
export async function chooseTemplate(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'id' | 'settings'>,
  input: { readonly face: string; readonly lookOptions: unknown },
): Promise<TemplateResult> {
  const entry = chooseableFace(input.face)
  if (entry === undefined) return { ok: false, error: 'unknown_face' }
  const options = mergeOptions(entry.manifest, readPresentation(venue.settings), input.lookOptions)
  const presentation = PresentationSchema.safeParse({ face: entry.id, options })
  if (!presentation.success) return { ok: false, error: 'invalid' }
  try {
    const stored = await setVenuePresentation(pool, tenantId, {
      venueId: venue.id as never,
      presentation: presentation.data,
    })
    return { ok: true, presentation: stored ?? presentation.data }
  } catch (error) {
    if (error instanceof VenuePresentationError) {
      return { ok: false, error: error.code === 'venue_not_found' ? 'not_found' : 'invalid' }
    }
    throw error
  }
}
