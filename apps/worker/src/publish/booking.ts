// A venue's booking file on the CDN (#577): `b/<venue id>.json` holds what the venue's booking page
// shows: its name, whether the page takes requests, its clock, each weekday's hours and its closed
// dates from today on. The guest page reads it and never the database (rule 4). Written by the
// `publish-booking` job, which the settings that change it queue in their own transaction, and
// after every publish. Idempotent: the file is put only when its bytes differ. A venue that is
// deleted or not published leaves the organisation's index, so its page cannot find the file; the
// file itself is left as it is.
//
// The forbidden-values walk (rule 3): the tenant id must not be anywhere in it.
import { bookingFileBytes, bookingPath, type PublishStore, publishPutOptions } from '@restro/assets'
import type { VenueId } from '@restro/core'
import { forbiddenPaths, readBookingFile } from '@restro/core/service'
import type { DbPool } from '@restro/db'

export interface BookingFileDeps {
  readonly pool: DbPool
  readonly store: PublishStore
  readonly now: () => Date
}

export type BookingFileResult =
  /** The tenant has no such live venue: nothing was written. */
  | { readonly status: 'unknown_venue' }
  /** The file was written, or was already right. */
  | { readonly status: 'done'; readonly written: boolean; readonly on: boolean }

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** Brings the venue's `b/<venue id>.json` in line with the database; see the header. */
export async function writeBookingFile(
  deps: BookingFileDeps,
  scope: { readonly tenantId: string; readonly venueId: string },
): Promise<BookingFileResult> {
  const file = await readBookingFile(deps.pool, scope.tenantId, scope.venueId, deps.now())
  if (file === null) return { status: 'unknown_venue' }
  const leaks = forbiddenPaths(file, new Set([scope.tenantId]))
  if (leaks.length > 0) {
    throw new Error(`the booking file holds a backend value at ${leaks.join(', ')}`)
  }
  const path = bookingPath(scope.venueId as VenueId)
  const bytes = bookingFileBytes(file)
  if (sameBytes(await deps.store.get(path), bytes)) {
    return { status: 'done', written: false, on: file.on }
  }
  await deps.store.put(path, bytes, publishPutOptions(path))
  return { status: 'done', written: true, on: file.on }
}
