// The files behind a venue's table QR codes (brief S3-07): `t/<token>.json` = {venue_public_id,
// venue_slug, table_label}, which `/t/<token>` reads to lead a guest to the menu (`menuPath`) with
// the table's name. A renamed venue changes `venue_slug`; the job writes the files again. The
// admin changes rows in the database (issue, retire, rename); this turns the rows into files, and
// is the ONLY writer of these files (the web app never writes the publish store).
//
// It is idempotent and safe to repeat: it writes the file of every active code of the venue unless
// the store already holds the same bytes, and removes the files of the codes named in `retired`.
// A code that is active again (it cannot be: tokens are random and never reused) is never removed.
//
// A DELETED venue (D76, `venues.archived_at`) has no files: the job withdraws them, so `/t/<token>`
// says the code is not active. The venue's till link is released when it is deleted, so it can no
// longer find its tables; the tokens to withdraw arrive in `retired` (core's `archiveVenue`
// reports them and the delete action hands them over). The tokens themselves are NOT retired: they
// stay on the tables in the database, and restoring the venue, linking its till again and running
// this job writes the same files back. A file is removed only when it names this venue, so a code
// that meanwhile belongs to another venue (its till venue was linked to one) is left alone.
// Whichever run is last leaves what the database says: a run looks at the venue before it writes
// and again after, and withdraws what it wrote if the venue was deleted meanwhile.
import {
  deleteTableTokenFile,
  type PublishStore,
  publishPutOptions,
  readTableTokenFile,
  tableTokenBytes,
  tableTokenPath,
} from '@restro/assets'
import type { NodeId } from '@restro/core'
import { loadTokenFiles } from '@restro/core/apply'
import type { DbPool } from '@restro/db'

import { venueState } from './venue-state'

export interface TableTokenDeps {
  readonly pool: DbPool
  readonly store: PublishStore
}

/** What one run did. */
export type TableTokensResult =
  /** The tenant has no such venue: nothing was written or removed. */
  | { readonly status: 'unknown_venue' }
  /**
   * The venue was deleted (D76): no file was written, and `removed` files that named it were taken
   * out of the store.
   */
  | { readonly status: 'withdrawn'; readonly removed: number }
  | {
      readonly status: 'done'
      /** Files put to the store (new or changed). */
      readonly written: number
      /** Files that were already right. */
      readonly unchanged: number
      /** Files of retired codes taken out of the store. */
      readonly removed: number
    }

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, index) => byte === b[index])
}

/**
 * Removes the files of `tokens` that name the venue (by its public code). A file that cannot be
 * read is under a token of this venue's own tables or of its retired ones, and goes too; a file of
 * another venue stays. Returns how many were removed.
 */
async function withdraw(
  deps: TableTokenDeps,
  venuePublicId: string,
  tokens: Iterable<string>,
): Promise<number> {
  let removed = 0
  for (const token of new Set(tokens)) {
    const bytes = await deps.store.get(tableTokenPath(token))
    if (bytes === null) continue
    const file = await readTableTokenFile(deps.store, token)
    if (file !== null && file.venue_public_id !== venuePublicId) continue
    await deps.store.delete(tableTokenPath(token))
    removed += 1
  }
  return removed
}

/** Brings the venue's `t/<token>.json` files in line with its codes; see the header. */
export async function writeTableTokenFiles(
  deps: TableTokenDeps,
  job: { readonly tenantId: string; readonly venueId: string; readonly retired: readonly string[] },
): Promise<TableTokensResult> {
  const wanted = await loadTokenFiles(deps.pool, job.tenantId, job.venueId)
  if (wanted === null) return { status: 'unknown_venue' }
  if (wanted.archived) {
    return { status: 'withdrawn', removed: await withdraw(deps, wanted.venuePublicId, job.retired) }
  }

  let written = 0
  let unchanged = 0
  for (const { token, tableLabel, menuId } of wanted.files) {
    const path = tableTokenPath(token)
    const bytes = tableTokenBytes({
      venue_public_id: wanted.venuePublicId,
      venue_slug: wanted.venueSlug,
      table_label: tableLabel,
      ...(menuId === null ? {} : { menu_id: menuId as NodeId }),
    })
    if (sameBytes(await deps.store.get(path), bytes)) {
      unchanged += 1
      continue
    }
    await deps.store.put(path, bytes, publishPutOptions(path))
    written += 1
  }

  const active = new Set(wanted.files.map((file) => file.token))
  let removed = 0
  for (const token of new Set(job.retired)) {
    if (active.has(token)) continue
    await deleteTableTokenFile(deps.store, token)
    removed += 1
  }

  // Deleted while the files were written: take back what this run put there (and the retired
  // ones), so the last run leaves what the database says.
  if ((await venueState(deps.pool, job.tenantId, job.venueId)) === 'archived') {
    const taken = await withdraw(deps, wanted.venuePublicId, [...active, ...job.retired])
    return { status: 'withdrawn', removed: taken }
  }
  return { status: 'done', written, unchanged, removed }
}
