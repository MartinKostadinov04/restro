// Whether a venue is still there for the jobs to work on (brief CF-18, D76). A deleted venue is only
// archived (`venues.archived_at`), so a job that was queued before the deletion still finds the row.
// Every job that writes for one venue asks first, and the jobs that leave files behind (the venue
// index, the table files) ask again after they wrote, so the last one to run leaves what the
// database says. Reads only.
import { type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

/** `live`: the venue exists and is not deleted; `archived`: deleted; `missing`: no such venue. */
export type VenueState = 'live' | 'archived' | 'missing'

export async function venueState(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueState> {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx.select({ archivedAt: venues.archivedAt }).from(venues).where(eq(venues.id, venueId)),
  )
  if (row === undefined) return 'missing'
  return row.archivedAt === null ? 'live' : 'archived'
}
