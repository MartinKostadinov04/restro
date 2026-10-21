// Whether a venue is still there for the jobs to work on, and whether guests may see it (brief
// CF-18, D76; D86). A deleted venue is only archived (`venues.archived_at`), so a job that was
// queued before the deletion still finds the row; an unpublished venue (`venues.unpublished_at`)
// is there to publish but has no files. Every job that writes for one venue asks first, and the
// jobs that leave files behind (the venue index, the table files) ask again after they wrote, so
// the last one to run leaves what the database says. Reads only.
import { type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

/**
 * `live`: the venue exists, is not deleted and not unpublished; `unpublished`: taken off guests'
 * phones (D86, its files are withdrawn; a publish brings it back); `archived`: deleted; `missing`:
 * no such venue.
 */
export type VenueState = 'live' | 'unpublished' | 'archived' | 'missing'

export async function venueState(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueState> {
  const [row] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ archivedAt: venues.archivedAt, unpublishedAt: venues.unpublishedAt })
      .from(venues)
      .where(eq(venues.id, venueId)),
  )
  if (row === undefined) return 'missing'
  if (row.archivedAt !== null) return 'archived'
  return row.unpublishedAt === null ? 'live' : 'unpublished'
}

/** True when the venue's guest files must not be out: deleted or unpublished. */
export function filesWithdrawn(state: VenueState): boolean {
  return state === 'archived' || state === 'unpublished'
}
