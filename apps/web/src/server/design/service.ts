// The Design page's server side (D129): what the page shows of the venue's design, and saving it.
// The one writer is `setDesign` in core/apply (rule 1), with the revision the page loaded. Who may
// ask (owners and admins, like the Integration tab) is the action's check.
//
// Two things that matter here:
//   - Done saves the WHOLE design, as the page holds it: there is no partial save.
//   - A save is checked against the revision: another person's save in between is refused, and the
//     answer carries the stored design for the page to reload.
//
// The logo's picture on the page is a signed link to the stored original, like the photos of the
// item sheet; guests never see it, they get the webp variants through the snapshot.
import type { AssetStore } from '@restro/assets'
import {
  type Actor,
  type ChangeSet,
  type DesignContent,
  designContentOf,
  designThemeOf,
  newId,
  type PairIssue,
  readDesign,
  type StoredDesign,
  type VenueTheme,
} from '@restro/core'
import { apply } from '@restro/core/apply'
import { assets, type DbPool, type Venue, withTenant } from '@restro/db'

import { eq } from 'drizzle-orm'

import { logError } from '../log'
import { canManageIntegration } from '../roles'

/** A saved logo as the page shows it. */
export interface DesignLogo {
  readonly assetId: string
  /** A signed link to the stored original, or null when it cannot be made. */
  readonly url: string | null
  readonly width: number
  readonly height: number
}

/** What the Design page shows. */
export interface DesignView {
  /** The revision of the record: 0 while the venue has none. A save names it. */
  readonly revision: number
  /** The saved design as a whole (Basic while the venue has no record). */
  readonly design: DesignContent
  /** The saved look, in the theme's terms: what the colour controls start from. */
  readonly theme: VenueTheme
  readonly logo: DesignLogo | null
  /** Owners and admins edit; everyone else reads. */
  readonly canEdit: boolean
}

/** The link lifetime for the page (the admin page is open for minutes, not hours). */
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

/** A stored design as the page shows it. */
async function designView(
  pool: DbPool,
  tenantId: string,
  { revision, design }: StoredDesign,
  store: () => Promise<Pick<AssetStore, 'getUrl'>>,
  role: string | null | undefined,
): Promise<DesignView> {
  return {
    revision,
    design: designContentOf(design),
    theme: designThemeOf(design),
    logo: await logoOf(pool, tenantId, design.logo_asset_id, store),
    canEdit: canManageIntegration(role),
  }
}

export type DesignSaveError =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'logo_not_usable'
  | 'unreadable'
  | 'stale'
  | 'failed'

/**
 * What saving a design answers. `unreadable` names the pairs that do not read; `stale` carries the
 * design as stored, for the page to reload.
 */
export type DesignSaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly error: Exclude<DesignSaveError, 'unreadable' | 'stale'> }
  | { readonly ok: false; readonly error: 'unreadable'; readonly issues: readonly PairIssue[] }
  | { readonly ok: false; readonly error: 'stale'; readonly view: DesignView }

/**
 * Saves a whole design through `apply` (rule 1), from the revision the page loaded. The caller has
 * checked the venue is the person's and their role; `view` is what a stale answer's stored design
 * is shown with.
 */
export async function saveDesign(
  pool: DbPool,
  tenantId: string,
  input: {
    readonly venueId: string
    readonly expectedRevision: number
    readonly design: DesignContent
    readonly actor: Actor
  },
  view: {
    readonly store: () => Promise<Pick<AssetStore, 'getUrl'>>
    readonly role: string | null | undefined
  },
): Promise<DesignSaveResult> {
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
    // A save that changes nothing keeps the revision it named.
    return { ok: true, revision: input.expectedRevision + (result.applied > 0 ? 1 : 0) }
  }
  if (rejected.code === 'stale_revision' && rejected.storedDesign !== undefined) {
    return {
      ok: false,
      error: 'stale',
      view: await designView(pool, tenantId, rejected.storedDesign, view.store, view.role),
    }
  }
  if (rejected.code === 'unreadable' && rejected.issues !== undefined) {
    return { ok: false, error: 'unreadable', issues: rejected.issues }
  }
  if (rejected.code === 'unknown_venue') return { ok: false, error: 'not_found' }
  if (rejected.code === 'logo_not_usable') return { ok: false, error: 'logo_not_usable' }
  return { ok: false, error: 'invalid' }
}
