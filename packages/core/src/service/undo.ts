// The time window of a staff Undo on Tonight (#219; Martin 10-29, B7). Every write that offers an
// Undo answers with a token: the Log entry it wrote (`seq`) and its time. The inverse command sends
// the token back; core then refuses it `undo_expired` once the write is older than
// `STAFF_UNDO_WINDOW_MS`, and `undo_stale` when the thing it touched changed again after the write.
// Without a token the inverse runs as a normal command (it is one). The token needs no table: the
// Log already has both numbers. A forged token can only make an Undo stricter or unlock what the
// command does without one, so it is no new right.

import { logEntries } from '@restro/db'
import { and, eq, gt, ne, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { STAFF_UNDO_WINDOW_MS } from '../table-order'
import type { ServiceTx } from './definition'

/** What the inverse command sends: the Log entry the write answered with. */
export const UndoTokenSchema = z.strictObject({ entry: z.int().positive() })

/** An undo token. */
export type UndoToken = z.infer<typeof UndoTokenSchema>

/** The refusals of an Undo: too old, and the thing was changed again meanwhile. */
export const UNDO_REFUSALS = ['undo_expired', 'undo_stale'] as const

/** The keys of an answer's details that carry the token. */
export const UNDO_ENTRY_KEY = 'undoEntry'
export const UNDO_AT_KEY = 'undoAt'

/**
 * Whether the write the token names is older than the window. An entry this venue does not have
 * (made up, or long purged) is expired.
 */
export async function undoExpired(stx: ServiceTx, token: UndoToken): Promise<boolean> {
  const [entry] = await stx.tx
    .select({ at: logEntries.at })
    .from(logEntries)
    .where(and(eq(logEntries.seq, token.entry), eq(logEntries.venueId, stx.venueId)))
  if (entry === undefined) return true
  const now = await stx.dbNow()
  return now.getTime() - entry.at.getTime() > STAFF_UNDO_WINDOW_MS
}

/**
 * Whether another command logged `match` at this venue after the token's entry. This command's
 * own entries are left out (they are the Undo itself), so the check runs after the handler wrote.
 */
export async function changedSince(
  stx: ServiceTx,
  entry: number,
  match: SQL | undefined,
): Promise<boolean> {
  const [found] = await stx.tx
    .select({ seq: logEntries.seq })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        gt(logEntries.seq, entry),
        ne(logEntries.jobId, stx.provenance.jobId),
        match,
      ),
    )
    .limit(1)
  return found !== undefined
}
