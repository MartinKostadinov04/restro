// Venue reads for the admin. Every query runs inside `withTenant`, so row-level security shows
// only the venues of the organisation (tenant) the signed-in person works in, even if a `where`
// clause is forgotten. Reads only: a venue's settings are written through core's writers.
//
// A deleted venue is only archived (`venues.archived_at`, D76). `listVenues` and `getVenue` leave
// it out, so the sidebar, every venue page (`notFound`), every list and every action that looks
// the venue up through `getVenue` treat it as gone; `listArchivedVenues` is the restore list.
import { isId } from '@restro/core'
import { barsyVenues, type Venue, venues, withTenant } from '@restro/db'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { cache } from 'react'

import { getPool } from './db'

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
 * True when a till is connected to the venue: today, a barsy venue is mapped to it (D64, D66). A
 * venue with a till gets its items from the till only, because items made by hand cannot reach
 * the POS; hand-made items are for venues without one. This is the one place that answers the
 * question: a later change (another kind of till, or a setting that allows display-only items on
 * a till venue) changes it here. Also false for an id that is not a venue of the tenant.
 */
export async function venueHasTill(tenantId: string, venueId: string): Promise<boolean> {
  if (!isId('vn', venueId)) return false
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx
      .select({ bid: barsyVenues.bid })
      .from(barsyVenues)
      .where(eq(barsyVenues.venueId, venueId))
      .limit(1),
  )
  return rows.length > 0
}
