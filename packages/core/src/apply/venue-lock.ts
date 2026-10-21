// The one shared check of every core writer that touches one venue (brief CF-18, D76): the venue is
// locked and must be live. A deleted venue is only archived (`venues.archived_at`), so its row is
// still there; without this check a save in a second browser tab, a sync that was already running,
// or a publish that was already queued would go on writing into a venue the owner deleted.
//
// The lock is what makes "a save and a delete never interleave": `archiveVenue` and `restoreVenue`
// take the row `FOR UPDATE`, every other writer takes it `FOR SHARE` (or `FOR UPDATE` when it
// rewrites `venues.settings` and needs its own read-modify-write serialised too). Postgres makes
// the second one wait for the first to commit, then the second reads the committed state: a save
// that comes second finds the venue archived and is refused; a delete that comes second waits for
// the save and then archives.
//
// Each writer keeps its own error type and its own code for a missing venue; this helper only says
// which of the two refusals applies, and `venueRefusalText` words it.

import { type Venue, venues } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { eq } from 'drizzle-orm'

/** Why a venue was refused: the tenant has none with this id, or it was deleted (archived). */
export type VenueRefusal = 'venue_missing' | 'venue_archived'

/** What `lockLiveVenue` found: the locked live venue, or the reason it is not one. */
export type LiveVenueLock =
  | { readonly refused: null; readonly venue: Venue }
  | { readonly refused: VenueRefusal; readonly venue: null }

/** How hard a writer locks the venue row. `update` is for writers that rewrite the row itself. */
export type VenueLockStrength = 'share' | 'update'

/**
 * Locks the venue row for the rest of the transaction and says whether it is live. Call it first
 * in every core writer that changes something of one venue (its settings, menu, tables, tags,
 * publishing, links). A venue of another tenant is invisible (row-level security): `venue_missing`.
 */
export async function lockLiveVenue(
  tx: WriteTx,
  venueId: string,
  strength: VenueLockStrength = 'share',
): Promise<LiveVenueLock> {
  const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for(strength)
  if (venue === undefined) return { refused: 'venue_missing', venue: null }
  if (venue.archivedAt !== null) return { refused: 'venue_archived', venue: null }
  return { refused: null, venue }
}

/** The refusal in words, for the error a writer throws or returns. */
export function venueRefusalText(venueId: string, refusal: VenueRefusal): string {
  return refusal === 'venue_archived'
    ? `the venue ${venueId} was deleted`
    : `this tenant has no venue ${venueId}`
}
