// Venue reads for the admin. Every query runs inside `withTenant`, so row-level security shows
// only the venues of the organisation (tenant) the signed-in person works in, even if a `where`
// clause is forgotten. Reads only: venue settings are not editable in Stage 1.
import { isId } from '@restro/core'
import { type Venue, venues, withTenant } from '@restro/db'
import { asc, eq } from 'drizzle-orm'
import { cache } from 'react'

import { getPool } from './db'

/** All venues of a tenant, by name. */
export function listVenues(tenantId: string): Promise<Venue[]> {
  return withTenant(getPool(), tenantId, (tx) =>
    tx.select().from(venues).orderBy(asc(venues.name), asc(venues.id)),
  )
}

/**
 * One venue of a tenant, or null (also when the id belongs to another tenant). Cached for the
 * duration of a request, so a page and its metadata share one query.
 */
export const getVenue = cache(async (tenantId: string, venueId: string): Promise<Venue | null> => {
  // Ids come from the URL: refuse anything that is not a venue id before it reaches a query.
  if (!isId('vn', venueId)) return null
  const rows = await withTenant(getPool(), tenantId, (tx) =>
    tx.select().from(venues).where(eq(venues.id, venueId)).limit(1),
  )
  return rows[0] ?? null
})
