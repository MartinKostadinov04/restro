// The Design tab's server side (brief SH-05a, D129): what the tab shows of the venue's design, and
// saving it. The one writer is `setDesign` in core/apply (rule 1), with the revision the tab loaded;
// this file turns what the tab's form and the Structure layout picker say into the whole record.
// Who may ask (owners and admins, like the Integration tab) is the action's check.
//
// Three things that matter here:
//   - A look is always saved WHOLE. `FullThemeSchema` refuses a theme without its font, corners,
//     shadow and light/dark policy, so a partial theme cannot reach the record.
//   - A save carries the whole record: the look's fields are laid over the stored design, so what
//     the form does not show (the Style, the other pages' values) stays as it is.
//   - A save is checked against the revision: another person's save in between is refused, and the
//     answer carries the stored design for the tab to reload.
//
// The logo's picture in the tab is a signed link to the stored original, like the photos of the
// item sheet; guests never see it, they get the webp variants through the snapshot.
import type { AssetStore } from '@restro/assets'
import {
  type Actor,
  type ChangeSet,
  cornersOfRadius,
  type DesignContent,
  type DesignValues,
  depthOfShadow,
  designThemeOf,
  newId,
  type PairIssue,
  readDesign,
  type StoredDesign,
  type VenueTheme,
  VenueThemeSchema,
} from '@restro/core'
import { apply } from '@restro/core/apply'
import { assets, type DbPool, type Venue, venues, withTenant } from '@restro/db'

import { eq } from 'drizzle-orm'
import type { z } from 'zod'

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
  /** The revision of the record: 0 while the venue has none. A save names it. */
  readonly revision: number
  /** The saved look, in the theme's terms (the default look while the venue has no record). */
  readonly theme: VenueTheme
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
  return logoOf(pool, tenantId, readDesign(venue.settings).design.logo_asset_id, store)
}

/** A logo with a signed link to it: null when there is none, or the asset is not stored. */
async function logoOf(
  pool: DbPool,
  tenantId: string,
  logoId: string | null,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
): Promise<DesignLogo | null> {
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

/** Reads the venue's saved design and the link of its logo. */
export async function loadDesign(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'settings'>,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
  role: string | null | undefined,
): Promise<DesignView> {
  return designView(pool, tenantId, readDesign(venue.settings), store, role)
}

/** A stored design as the tab shows it. */
async function designView(
  pool: DbPool,
  tenantId: string,
  { revision, design }: StoredDesign,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
  role: string | null | undefined,
): Promise<DesignView> {
  return {
    revision,
    theme: designThemeOf(design),
    logo: await logoOf(pool, tenantId, design.logo_asset_id, store),
    canEdit: canManageIntegration(role),
  }
}

/** The venue's settings as stored now, or null when this tenant has no such venue. */
async function storedSettings(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<Pick<Venue, 'settings'> | null> {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
  )
  return row ?? null
}

/** What a design save can be refused for, in the tab's words, with what `apply` answered. */
type DesignRefusal =
  | { readonly refused: 'not_found' | 'logo_not_usable' | 'invalid' }
  | { readonly refused: 'stale'; readonly stored: StoredDesign }
  | { readonly refused: 'unreadable'; readonly issues: readonly PairIssue[] }

/** Saves a whole design through `apply` (rule 1). The new revision, or why it was refused. */
async function saveDesign(
  pool: DbPool,
  tenantId: string,
  input: {
    readonly venueId: string
    readonly expectedRevision: number
    readonly design: DesignContent
    readonly actor: Actor
  },
): Promise<{ readonly ok: true; readonly stored: StoredDesign } | DesignRefusal> {
  const changeSet: ChangeSet = {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: input.actor,
    observedAt: new Date().toISOString(),
    ops: [
      {
        op: 'setDesign',
        venueId: input.venueId as never,
        expectedRevision: input.expectedRevision,
        design: input.design,
      },
    ],
  }
  const result = await apply(pool, tenantId, changeSet)
  const rejected = result.rejected[0]
  if (rejected === undefined) {
    return {
      ok: true,
      stored: {
        // A save that changes nothing keeps the revision it named.
        revision: input.expectedRevision + (result.applied > 0 ? 1 : 0),
        design: input.design,
      },
    }
  }
  if (rejected.code === 'stale_revision' && rejected.storedDesign !== undefined) {
    return { refused: 'stale', stored: rejected.storedDesign }
  }
  if (rejected.code === 'unreadable' && rejected.issues !== undefined) {
    return { refused: 'unreadable', issues: rejected.issues }
  }
  if (rejected.code === 'unknown_venue') return { refused: 'not_found' }
  if (rejected.code === 'logo_not_usable') return { refused: 'logo_not_usable' }
  return { refused: 'invalid' }
}

// --- The look ------------------------------------------------------------------------------------

/**
 * A complete look: the core schema, with the v2 fields the form always sends made required. A
 * look is built either from the three colours or from one brand colour, never both.
 */
export const FullThemeSchema = VenueThemeSchema.required({
  font: true,
  radius: true,
  shadow: true,
  scheme: true,
}).refine((theme) => theme.colors === undefined || theme.brand === undefined, {
  message: 'a look is built from three colours or from a brand colour, not both',
  path: ['brand'],
})

type FullTheme = z.output<typeof FullThemeSchema>

export type LookError =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'logo_not_usable'
  | 'unreadable'
  | 'stale'
  | 'failed'

/**
 * What saving a look answers. `unreadable` names the pairs that do not read; `stale` carries the
 * design as stored, for the tab to reload.
 */
export type LookResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly error: Exclude<LookError, 'unreadable' | 'stale'> }
  | { readonly ok: false; readonly error: 'unreadable'; readonly issues: readonly PairIssue[] }
  | { readonly ok: false; readonly error: 'stale'; readonly view: DesignView }

/** The stored design with the look's fields laid over it: the whole record a save carries. */
function designWithLook(stored: DesignContent, theme: FullTheme): DesignContent {
  return {
    style: stored.style,
    values: {
      ...stored.values,
      general: {
        ...stored.values.general,
        body_font: theme.font,
        corners: cornersOfRadius(theme.radius),
        depth: depthOfShadow(theme.shadow),
        screen: theme.scheme,
      },
    },
    ...(theme.colors === undefined ? {} : { colors: theme.colors }),
    ...(theme.brand === undefined ? {} : { brand: theme.brand }),
    ...(theme.overrides === undefined ? {} : { overrides: theme.overrides }),
    logo_asset_id: theme.logo_asset_id,
  }
}

/**
 * Saves the look of a venue, from the revision the tab loaded. The caller has checked the venue is
 * the person's and their role; `view` is what a stale answer's stored design is shown with.
 */
export async function saveLook(
  pool: DbPool,
  tenantId: string,
  input: {
    readonly venueId: string
    readonly expectedRevision: number
    readonly theme: unknown
    readonly actor: Actor
  },
  view: {
    readonly store: () => Promise<Pick<AssetStore, 'getUrl'>>
    readonly role: string | null | undefined
  },
): Promise<LookResult> {
  const theme = FullThemeSchema.safeParse(input.theme)
  if (!theme.success) return { ok: false, error: 'invalid' }
  const venue = await storedSettings(pool, tenantId, input.venueId)
  if (venue === null) return { ok: false, error: 'not_found' }
  const stale = async (current: StoredDesign): Promise<LookResult> => ({
    ok: false,
    error: 'stale',
    view: await designView(pool, tenantId, current, view.store, view.role),
  })
  const stored = readDesign(venue.settings)
  // The look is laid over the record read here, so it must be the one the tab started from.
  if (stored.revision !== input.expectedRevision) return stale(stored)

  const saved = await saveDesign(pool, tenantId, {
    venueId: input.venueId,
    expectedRevision: input.expectedRevision,
    design: designWithLook(stored.design, theme.data),
    actor: input.actor,
  })
  if ('ok' in saved) return { ok: true, revision: saved.stored.revision }
  if (saved.refused === 'stale') return stale(saved.stored)
  if (saved.refused === 'unreadable') {
    return { ok: false, error: 'unreadable', issues: saved.issues }
  }
  return { ok: false, error: saved.refused }
}

// --- The layout ----------------------------------------------------------------------------------

export type LayoutError = 'invalid' | 'not_allowed' | 'unknown_venue' | 'stale' | 'failed'

/** What saving the layout answers. */
export type LayoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: LayoutError }

/**
 * Saves the layout guests start in and whether they may switch it (the composer's "Menu layout"):
 * the Items page's two values of the record as stored now. Every venue's, a till venue's too; it
 * reaches guests with the next publish.
 */
export async function saveLayout(
  pool: DbPool,
  tenantId: string,
  input: {
    readonly venueId: string
    readonly layout: DesignValues['items']['layout']
    readonly guestSwitch: boolean
    readonly actor: Actor
  },
): Promise<LayoutResult> {
  const venue = await storedSettings(pool, tenantId, input.venueId)
  if (venue === null) return { ok: false, error: 'unknown_venue' }
  const { revision, design } = readDesign(venue.settings)
  const saved = await saveDesign(pool, tenantId, {
    venueId: input.venueId,
    expectedRevision: revision,
    design: {
      ...design,
      values: {
        ...design.values,
        items: {
          ...design.values.items,
          layout: input.layout,
          guest_switch: input.guestSwitch ? 'on' : 'off',
        },
      },
    },
    actor: input.actor,
  })
  if ('ok' in saved) return { ok: true }
  if (saved.refused === 'stale') return { ok: false, error: 'stale' }
  if (saved.refused === 'not_found') return { ok: false, error: 'unknown_venue' }
  return { ok: false, error: 'invalid' }
}
