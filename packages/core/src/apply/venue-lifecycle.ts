// The life of a venue after it exists (brief CF-18, D76): rename it, delete it, bring it back.
//
// Deleting a venue ARCHIVES it. Nothing is erased: history is append-only (rule 2) and the app
// role has no DELETE on `venues`. The row, its menus, areas, tables, tags, snapshots and settings
// stay, and so do its public code and its tables' QR codes, so a restore brings the same
// addresses back. What a deletion does:
//   - sets `venues.archived_at`;
//   - releases the venue's till link in the same transaction (the till venue's `venue_id` goes back to
//     null, so the till venue is free for another venue of ours) and remembers it
//     (`settings.till_before_delete`), so a restore can link it again (adjustments V1);
//   - reports the code files of the venue's tables (all of them, hidden ones too: `codeFileNames`).
//     The caller hands them to the worker's table-files job as the files to withdraw (the codes
//     themselves are NOT retired: the tables keep them for a restore).
// Everything else follows from the flag: `lockLiveVenue` makes every other writer refuse an
// archived venue, the admin reads leave it out, and the worker's jobs withdraw its guest files and
// stop syncing and publishing it.
//
// Restoring clears the flag, links the till venue the venue served again when it is still free
// (refused when another venue holds it, adjustments V1) and leaves the venue unpublished: the
// owner publishes, the way a new venue starts.
//
// Rule 1 keeps these writes here. Each is one transaction with the venue row locked `FOR UPDATE`,
// which makes a concurrent save (a `FOR SHARE` lock, ./venue-lock.ts) wait for the delete or the
// delete wait for the save. Like the other writers of a venue's own settings, none of the three
// writes an `events` row: that changelog is about nodes and their values.

import { type DbPool, venues, venueTables } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import {
  isTillLink,
  relinkTillVenue,
  type TillLink,
  tillVenueLinks,
} from '../connectors/till-venues'
import { isId } from '../ids'
import { codeFileNames } from './code-files'
import { ProvisionError } from './provision'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The longest venue name (the same limit as creating a venue). */
export const MAX_VENUE_NAME_LENGTH = 120

/**
 * True when the venue serves a till venue (its menus come from a POS). Inside a transaction the
 * caller owns; the purge asks before erasing a venue (a deletion releases the link, D76).
 */
export async function venueServesTill(tx: WriteTx, venueId: string): Promise<boolean> {
  const [link] = await tx
    .select({ bid: tillVenueLinks.bid })
    .from(tillVenueLinks)
    .where(eq(tillVenueLinks.venueId, venueId))
    .limit(1)
  return link !== undefined
}

function checkedIds(tenantId: string, venueId: string): void {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
}

/**
 * The code files of every table of the venue that is not deleted, hidden ones included (a
 * withdrawn file that is not there is no harm): the code's hash, and the plain code while it is
 * stored (`codeFileNames`). Sorted here in code point order (never by the database: its collation
 * differs between CI and a local machine, CLAUDE.md). What a delete or an unpublish hands to the
 * worker's table-files job as the files to withdraw; the codes stay on the tables.
 */
async function tableTokensOf(tx: WriteTx, venueId: string): Promise<string[]> {
  const rows = await tx
    .select({ qrToken: venueTables.qrToken, qrCodeHash: venueTables.qrCodeHash })
    .from(venueTables)
    .where(
      and(
        eq(venueTables.venueId, venueId),
        isNull(venueTables.archivedAt),
        isNotNull(venueTables.qrCodeHash),
      ),
    )
  return rows.flatMap(codeFileNames).sort()
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
   * The code files of the venue's tables as they stood at the moment of the deletion, sorted
   * (`t/<code hash>.json`, and `t/<code>.json` for a code still in plain): they have to be
   * withdrawn; the codes stay in the database.
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
    const tableTokens = await tableTokensOf(tx, venueId)

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
      .returning({ bid: tillVenueLinks.bid, integrationId: tillVenueLinks.integrationId })
    const [link] = released
    if (link !== undefined) {
      const remembered: TillLink = { integration_id: link.integrationId, bid: link.bid }
      await tx
        .update(venues)
        .set({
          settings: sql`${venues.settings} || jsonb_build_object('till_before_delete', ${JSON.stringify(remembered)}::jsonb)`,
        })
        .where(eq(venues.id, venueId))
    }
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
  /** True when the till venue it served before was linked to it again (adjustments V1). */
  readonly relinked: boolean
}

/**
 * Brings a deleted venue back: clears `archived_at` and marks the venue unpublished (D86: a
 * restored venue is a Draft until someone publishes it; its guest files stay withdrawn till
 * then). The till venue it served before is linked to it again when it is still free (its tables
 * come back with it); when another venue serves it now the restore is refused (`till_taken`,
 * naming that venue), and nothing changes (adjustments V1); a till venue that is not listed any
 * more, or whose instance was removed (D81), is not linked: the venue comes back unlinked. The
 * venue's public code and table codes are the ones it always had, so the publish brings the same
 * addresses back. Restoring a live venue changes nothing. Refuses a venue the tenant does not
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
    if (venue.archivedAt === null) return { venueId, changed: false, relinked: false }
    await tx
      .update(venues)
      .set({
        archivedAt: null,
        unpublishedAt: sql`now()`,
        settings: sql`${venues.settings} - 'till_before_delete'`,
      })
      .where(eq(venues.id, venueId))
    // The venue is live again before its tables are mirrored; a refusal rolls all of it back.
    const remembered = (venue.settings as { till_before_delete?: unknown }).till_before_delete
    let relinked = false
    if (isTillLink(remembered)) {
      const outcome = await relinkTillVenue(tx, tenantId, venueId, remembered)
      if (outcome.status === 'taken') {
        throw new ProvisionError(
          'till_taken',
          `the till venue this venue served is linked to "${outcome.holder.name}" now`,
          { details: { holder: outcome.holder.name } },
        )
      }
      relinked = outcome.status === 'linked'
    }
    return { venueId, changed: true, relinked }
  })
}

/** What `unpublishVenue` did. */
export interface UnpublishedVenue {
  readonly venueId: string
  /** False when the venue was unpublished already (nothing was written, `tableTokens` is empty). */
  readonly changed: boolean
  /** When the venue was unpublished (now, or when it was before). */
  readonly unpublishedAt: Date
  /**
   * The code files of the venue's tables, sorted: the caller hands them to the worker's
   * table-files job as the files to withdraw (the codes stay on the tables; the next publish
   * writes the files back).
   */
  readonly tableTokens: readonly string[]
}

/**
 * Takes a venue off guests' phones without deleting anything (D86: back to Draft): sets
 * `venues.unpublished_at` and reports the table codes whose files must go. The worker's file jobs
 * then withdraw its address and table files; the next publish of any of its menus clears the flag
 * (`publishMenu`) and the files come back. Nothing else changes: menus, versions, tables and
 * codes stay as they are. Unpublishing an unpublished venue changes nothing. Refuses a venue the
 * tenant does not have (`venue_missing`) and a deleted one (`venue_archived`).
 */
export async function unpublishVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<UnpublishedVenue> {
  checkedIds(tenantId, venueId)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    if (locked.venue.unpublishedAt !== null) {
      return {
        venueId,
        changed: false,
        unpublishedAt: locked.venue.unpublishedAt,
        tableTokens: [],
      }
    }
    const tableTokens = await tableTokensOf(tx, venueId)
    const [row] = await tx
      .update(venues)
      .set({ unpublishedAt: sql`now()` })
      .where(eq(venues.id, venueId))
      .returning({ unpublishedAt: venues.unpublishedAt })
    if (row?.unpublishedAt == null) throw new Error('the venue could not be unpublished')
    return { venueId, changed: true, unpublishedAt: row.unpublishedAt, tableTokens }
  })
}
