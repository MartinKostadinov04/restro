// The life of a venue after it exists (brief CF-18, D76): rename it, delete it, bring it back.
//
// Deleting a venue ARCHIVES it. Nothing is erased: history is append-only (rule 2) and the app
// role has no DELETE on `venues`. The row, its menus, areas, tables, tags, snapshots and settings
// stay, and so do its public code and its tables' QR tokens, so a restore brings the same
// addresses back. What a deletion does:
//   - sets `venues.archived_at`;
//   - releases the venue's till link in the same transaction (the till venue's `venue_id` goes back to
//     null, so the till venue is free for another venue of ours);
//   - reports the QR tokens of the venue's tables (all of them, hidden ones too). The caller hands
//     them to the worker's table-files job as the files to withdraw (the tokens themselves are NOT
//     retired: the tables keep them for a restore).
// Everything else follows from the flag: `lockLiveVenue` makes every other writer refuse an
// archived venue, the admin reads leave it out, and the worker's jobs withdraw its guest files and
// stop syncing and publishing it.
//
// Restoring clears the flag. It does not link the till again and it does not publish: the owner
// does both, the way a new venue starts.
//
// Rule 1 keeps these writes here. Each is one transaction with the venue row locked `FOR UPDATE`,
// which makes a concurrent save (a `FOR SHARE` lock, ./venue-lock.ts) wait for the delete or the
// delete wait for the save. Like the other writers of a venue's own settings, none of the three
// writes an `events` row: that changelog is about nodes and their values.

import { type DbPool, venues, venueTables } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { tillVenueLinks } from '../connectors/till-venues'
import { isId } from '../ids'
import { ProvisionError } from './provision'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The longest venue name (the same limit as creating a venue). */
export const MAX_VENUE_NAME_LENGTH = 120

function checkedIds(tenantId: string, venueId: string): void {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
}

/** What `renameVenue` did. */
export interface RenamedVenue {
  readonly venueId: string
  /** The name as stored now (trimmed). */
  readonly name: string
  /** False when the venue already had this name (nothing was written). */
  readonly changed: boolean
}

/**
 * Changes a venue's name: trimmed, 1 to 120 characters (the rule of creating a venue). The name
 * reaches guests with the next publish. The same name again writes nothing. Refuses a bad name
 * (`invalid_input`), a venue the tenant does not have (`venue_missing`) and a deleted one
 * (`venue_archived`).
 */
export async function renameVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  name: string,
): Promise<RenamedVenue> {
  checkedIds(tenantId, venueId)
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') throw new ProvisionError('invalid_input', 'the venue name must not be empty')
  if ([...trimmed].length > MAX_VENUE_NAME_LENGTH) {
    throw new ProvisionError(
      'invalid_input',
      `the venue name is longer than ${MAX_VENUE_NAME_LENGTH} characters`,
    )
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    if (locked.venue.name === trimmed) return { venueId, name: trimmed, changed: false }
    await tx.update(venues).set({ name: trimmed }).where(eq(venues.id, venueId))
    return { venueId, name: trimmed, changed: true }
  })
}

/** What `archiveVenue` did. */
export interface ArchivedVenue {
  readonly venueId: string
  /** False when the venue was archived already (nothing was written, `tableTokens` is empty). */
  readonly changed: boolean
  /** When the venue was archived (now, or when it was before). */
  readonly archivedAt: Date
  /** True when a till link was released. */
  readonly releasedTill: boolean
  /**
   * The QR tokens of the venue's tables as they stood at the moment of the deletion, sorted. Their
   * files `t/<token>.json` have to be withdrawn; the tokens stay in the database.
   */
  readonly tableTokens: readonly string[]
}

/**
 * Deletes a venue by archiving it (see the header): sets `archived_at`, releases the till link and
 * reports the table tokens, all in one transaction, so a failure rolls all of it back. Archiving an
 * archived venue changes nothing. Refuses a venue the tenant does not have (`venue_missing`).
 */
export async function archiveVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<ArchivedVenue> {
  checkedIds(tenantId, venueId)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for('update')
    if (venue === undefined) {
      throw new ProvisionError('venue_missing', venueRefusalText(venueId, 'venue_missing'))
    }
    if (venue.archivedAt !== null) {
      return {
        venueId,
        changed: false,
        archivedAt: venue.archivedAt,
        releasedTill: false,
        tableTokens: [],
      }
    }
    // The tokens of every table that is not deleted, hidden ones included (a withdrawn file that
    // is not there is no harm).
    const tokenRows = await tx
      .select({ token: venueTables.qrToken })
      .from(venueTables)
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNull(venueTables.archivedAt),
          isNotNull(venueTables.qrToken),
        ),
      )
      .orderBy(asc(venueTables.qrToken))
    const tableTokens = tokenRows.flatMap((row) => (row.token === null ? [] : [row.token]))

    const [archived] = await tx
      .update(venues)
      .set({ archivedAt: sql`now()` })
      .where(eq(venues.id, venueId))
      .returning({ archivedAt: venues.archivedAt })
    if (archived?.archivedAt == null) throw new Error('the venue could not be archived')

    const released = await tx
      .update(tillVenueLinks)
      .set({ venueId: null, updatedAt: new Date() })
      .where(eq(tillVenueLinks.venueId, venueId))
      .returning({ bid: tillVenueLinks.bid })
    return {
      venueId,
      changed: true,
      archivedAt: archived.archivedAt,
      releasedTill: released.length > 0,
      tableTokens,
    }
  })
}

/** What `restoreVenue` did. */
export interface RestoredVenue {
  readonly venueId: string
  /** False when the venue was live already (nothing was written). */
  readonly changed: boolean
}

/**
 * Brings a deleted venue back: clears `archived_at`. It does not link the till again and does not
 * publish; the venue comes back as a new one would, and its public code and table codes are the
 * ones it always had. Restoring a live venue changes nothing. Refuses a venue the tenant does not
 * have (`venue_missing`).
 */
export async function restoreVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<RestoredVenue> {
  checkedIds(tenantId, venueId)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId)).for('update')
    if (venue === undefined) {
      throw new ProvisionError('venue_missing', venueRefusalText(venueId, 'venue_missing'))
    }
    if (venue.archivedAt === null) return { venueId, changed: false }
    await tx.update(venues).set({ archivedAt: null }).where(eq(venues.id, venueId))
    return { venueId, changed: true }
  })
}
