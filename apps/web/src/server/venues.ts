// Venue reads for the admin. Every query runs inside `withTenant`, so row-level security shows
// only the venues of the organisation (tenant) the signed-in person works in, even if a `where`
// clause is forgotten. Reads only: a venue's settings are written through core's writers.
//
// A deleted venue is only archived (`venues.archived_at`, D76). `listVenues` and `getVenue` leave
// it out, so the sidebar, every venue page (`notFound`), every list and every action that looks
// the venue up through `getVenue` treat it as gone; `listArchivedVenues` is the restore list.
import { guestMenuPath, isId, isLocale, type Locale, venueStateOf } from '@restro/core'
import { organizationAddressIn } from '@restro/core/apply'
import {
  type DbPool,
  integrations,
  publishPointers,
  barsyVenues as tillVenueLinks,
  type Venue,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { cache } from 'react'

import { getPool } from './db'
import type { NewVenueInstance, NewVenueSources, VenueCard } from './venues-result'

export type { VenueCard } from './venues-result'

/** All live venues of a tenant, by name. */
export function listVenues(tenantId: string): Promise<Venue[]> {
  return withTenant(getPool(), tenantId, (tx) =>
    tx
      .select()
      .from(venues)
      .where(isNull(venues.archivedAt))
      .orderBy(asc(venues.name), asc(venues.id)),
  )
}

/**
 * What the All venues cards show (D86), for the live venues of a tenant, by name: the state
 * (Draft or Live, `venueStateOf`), the POS instance the venue is linked to and its name there,
 * and the guest address `/m/<organisation>/<venue>` (D84). One query for the venues with their
 * link, their instance and whether their live menu has a published version, and one for the
 * organisation's slug: the same two however many venues there are. Archived venues are the bin's
 * (`listArchivedVenues`), not a card's.
 */
export function listVenueCards(pool: DbPool, tenantId: string): Promise<VenueCard[]> {
  return withTenant(pool, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: venues.id,
        name: venues.name,
        slug: venues.slug,
        archivedAt: venues.archivedAt,
        unpublishedAt: venues.unpublishedAt,
        publishedMenuId: publishPointers.menuId,
        instanceName: integrations.name,
        tillVenueName: tillVenueLinks.name,
      })
      .from(venues)
      // The pointer of the venue's live menu: at most one row (its key is menu + venue).
      .leftJoin(
        publishPointers,
        and(eq(publishPointers.venueId, venues.id), eq(publishPointers.menuId, venues.liveMenuId)),
      )
      // A venue serves at most one POS venue (unique on venue_id).
      .leftJoin(tillVenueLinks, eq(tillVenueLinks.venueId, venues.id))
      .leftJoin(
        integrations,
        and(
          eq(integrations.tenantId, tillVenueLinks.tenantId),
          eq(integrations.id, tillVenueLinks.integrationId),
        ),
      )
      .where(isNull(venues.archivedAt))
      .orderBy(asc(venues.name), asc(venues.id))
    const organization = await organizationAddressIn(tx, tenantId)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      // Only a draft or a live venue is read (the bin is left out above).
      state: venueStateOf({
        archivedAt: row.archivedAt,
        unpublishedAt: row.unpublishedAt,
        livePublished: row.publishedMenuId !== null,
      }) as VenueCard['state'],
      instanceName: row.instanceName,
      tillVenueName: row.tillVenueName,
      guestPath:
        organization === null
          ? null
          : guestMenuPath({ organization: organization.slug, venue: row.slug }),
    }))
  })
}

/**
 * What step 1 and 2 of the New venue dialog offer (D85, D87): the organisation's active POS
 * instances (the connected ones; S1's removed instances will be left out here too) with the venues
 * each reports and the venue of ours each already serves, and the organisation's slug for a
 * hand-made venue's address preview. Two queries and the slug, whatever the number of instances.
 */
export function listNewVenueSources(pool: DbPool, tenantId: string): Promise<NewVenueSources> {
  return withTenant(pool, tenantId, async (tx) => {
    const instances = await tx
      .select({ id: integrations.id, name: integrations.name })
      .from(integrations)
      .where(eq(integrations.status, 'connected'))
      .orderBy(asc(integrations.name), asc(integrations.id))
    const tillVenues = await tx
      .select({
        integrationId: tillVenueLinks.integrationId,
        bid: tillVenueLinks.bid,
        name: tillVenueLinks.name,
        linkedVenueName: venues.name,
      })
      .from(tillVenueLinks)
      .leftJoin(
        venues,
        and(eq(venues.tenantId, tillVenueLinks.tenantId), eq(venues.id, tillVenueLinks.venueId)),
      )
      .orderBy(asc(tillVenueLinks.name), asc(tillVenueLinks.bid))
    const organization = await organizationAddressIn(tx, tenantId)
    const listed: NewVenueInstance[] = instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      tillVenues: tillVenues
        .filter((row) => row.integrationId === instance.id)
        .map((row) => ({ bid: row.bid, name: row.name, linkedVenueName: row.linkedVenueName })),
    }))
    return { organizationSlug: organization?.slug ?? null, instances: listed }
  })
}

/** What `createVenueAction` needs to know about the POS venue it makes a venue from. */
export interface TillVenueToAdd {
  /** The POS venue's name there: the new venue's name (D85). */
  readonly name: string
  /** The language of the instance's untagged text: the new venue's main language (D77). */
  readonly defaultLocale: Locale
  /** True when the POS venue serves a venue of ours already. */
  readonly linked: boolean
}

/**
 * One venue of one connected POS instance of the tenant, or null (no such instance, one that is
 * not connected, or a venue it does not report; also another tenant's, which row-level security
 * hides). The instance's language is `config.default_locale`, Bulgarian when it has none.
 */
export async function loadTillVenueToAdd(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
): Promise<TillVenueToAdd | null> {
  if (!isId('in', integrationId)) return null
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({
        name: tillVenueLinks.name,
        venueId: tillVenueLinks.venueId,
        config: integrations.config,
      })
      .from(tillVenueLinks)
      .innerJoin(
        integrations,
        and(
          eq(integrations.tenantId, tillVenueLinks.tenantId),
          eq(integrations.id, tillVenueLinks.integrationId),
        ),
      )
      .where(
        and(
          eq(tillVenueLinks.integrationId, integrationId),
          eq(tillVenueLinks.bid, bid),
          eq(integrations.status, 'connected'),
        ),
      )
      .limit(1),
  )
  if (row === undefined) return null
  const language = row.config.default_locale
  return {
    name: row.name,
    defaultLocale: isLocale(language) ? language : 'bg_BG',
    linked: row.venueId !== null,
  }
}

/**
 * The deleted venues of a tenant, the most recently deleted first: what Settings > Deleted venues
 * offers to restore.
 */
export function listArchivedVenues(tenantId: string): Promise<Venue[]> {
  return withTenant(getPool(), tenantId, (tx) =>
    tx
      .select()
      .from(venues)
      .where(isNotNull(venues.archivedAt))
      .orderBy(desc(venues.archivedAt), asc(venues.id)),
  )
}

/**
 * One live venue of a tenant, or null (also when the id belongs to another tenant, and when the
 * venue was deleted). Cached for the duration of a request, so a page and its metadata share one
 * query.
 */
export const getVenue = cache(async (tenantId: string, venueId: string): Promise<Venue | null> => {
  // Ids come from the URL: refuse anything that is not a venue id before it reaches a query.
  if (!isId('vn', venueId)) return null
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx
      .select()
      .from(venues)
      .where(and(eq(venues.id, venueId), isNull(venues.archivedAt)))
      .limit(1),
  )
  return rows[0] ?? null
})

/**
 * One venue of a tenant in any state, live or deleted, or null. Only the delete action asks for
 * it, to tell "already deleted" from "not yours"; pages and every other action use `getVenue`.
 */
export async function getVenueInAnyState(tenantId: string, venueId: string): Promise<Venue | null> {
  if (!isId('vn', venueId)) return null
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx.select().from(venues).where(eq(venues.id, venueId)).limit(1),
  )
  return rows[0] ?? null
}

/**
 * True when a till is connected to the venue: today, a POS venue is mapped to it (D64, D66). A
 * venue with a till gets its items from the till only, because items made by hand cannot reach
 * the POS; hand-made items are for venues without one. This is the one place that answers the
 * question: a later change (another kind of till, or a setting that allows display-only items on
 * a till venue) changes it here. Also false for an id that is not a venue of the tenant.
 */
export async function venueHasTill(tenantId: string, venueId: string): Promise<boolean> {
  if (!isId('vn', venueId)) return false
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx
      .select({ bid: tillVenueLinks.bid })
      .from(tillVenueLinks)
      .where(eq(tillVenueLinks.venueId, venueId))
      .limit(1),
  )
  return rows.length > 0
}
