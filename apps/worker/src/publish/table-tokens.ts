// The files behind a venue's table QR codes (brief S3-07): `t/<token>.json` = {venue_public_id,
// venue_slug, table_label}, which `/t/<token>` reads to lead a guest to the menu (`menuPath`) with
// the table's name. A renamed venue changes `venue_slug`; the job writes the files again. The
// admin changes rows in the database (issue, retire, rename); this turns the rows into files, and
// is the ONLY writer of these files (the web app never writes the publish store).
//
// It is idempotent and safe to repeat: it writes the file of every active code of the venue unless
// the store already holds the same bytes, and removes the files of the codes named in `retired`.
// A code that is active again (it cannot be: tokens are random and never reused) is never removed.
import {
  deleteTableTokenFile,
  type PublishStore,
  publishPutOptions,
  tableTokenBytes,
  tableTokenPath,
} from '@restro/assets'
import { loadTokenFiles } from '@restro/core/apply'
import type { DbPool } from '@restro/db'

export interface TableTokenDeps {
  readonly pool: DbPool
  readonly store: PublishStore
}

/** What one run did. */
export type TableTokensResult =
  /** The tenant has no such venue: nothing was written or removed. */
  | { readonly status: 'unknown_venue' }
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

/** Brings the venue's `t/<token>.json` files in line with its codes; see the header. */
export async function writeTableTokenFiles(
  deps: TableTokenDeps,
  job: { readonly tenantId: string; readonly venueId: string; readonly retired: readonly string[] },
): Promise<TableTokensResult> {
  const wanted = await loadTokenFiles(deps.pool, job.tenantId, job.venueId)
  if (wanted === null) return { status: 'unknown_venue' }

  let written = 0
  let unchanged = 0
  for (const { token, tableLabel } of wanted.files) {
    const path = tableTokenPath(token)
    const bytes = tableTokenBytes({
      venue_public_id: wanted.venuePublicId,
      venue_slug: wanted.venueSlug,
      table_label: tableLabel,
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
  return { status: 'done', written, unchanged, removed }
}
