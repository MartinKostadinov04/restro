// Writing what a publish decided into the publish store (brief S3-01b). `publishMenu` (core/apply)
// only moves rows in the database; these functions turn the current pointer into the files a guest
// page reads: `snap/<sn>.json`, `m/<menu>/<venue>/current.json` and `m/<menu>/<venue>/live.json`,
// and (S3-03) the slug index `v/<venue slug>.json` that `/m/<slug>` starts from.
//
// Both are idempotent and safe to repeat, which is what makes `publish-files` a repair: they
// compare with what is in the store and write only what is missing or different. The snapshot
// file always goes first, so a reader that finds `current.json` never finds a pointer to a
// snapshot that is not there yet, and the slug index goes last, so a reader that finds it finds a
// menu that is published.
import {
  currentPath,
  livePath,
  type PublishStore,
  publishPutOptions,
  readVenueIndex,
  snapshotPath,
  venueIndexBytes,
  venueIndexPath,
} from '@restro/assets'
import type { NodeId, VenueId } from '@restro/core'
import { loadCurrentSnapshot, loadLiveOverlay } from '@restro/core/apply'
import { type DbPool, publishPointers, venues, withTenant } from '@restro/db'
import { and, eq } from 'drizzle-orm'

export interface PublishFilesDeps {
  readonly pool: DbPool
  readonly store: PublishStore
  readonly now: () => Date
}

/** One menu of one venue. */
export interface PublishScope {
  readonly tenantId: string
  readonly menuId: NodeId
  readonly venueId: VenueId
}

/** What happened to the slug index `v/<slug>.json`. */
export type SlugIndexStatus = 'written' | 'unchanged'

/**
 * `v/<slug>.json` names another venue, so this venue's address `/m/<slug>` is not its own. The
 * database keeps venue slugs globally unique (`venues_slug_unique`), so this means the store holds
 * a foreign or stale file; it is never overwritten, and the job fails so that someone looks.
 */
export class VenueAddressTakenError extends Error {
  override name = 'VenueAddressTakenError'
  readonly slug: string

  constructor(slug: string) {
    super(
      `the address /m/${slug} belongs to another venue (v/${slug}.json names a different venue): ` +
        'the menu is not served there until the venue slug or the file is fixed',
    )
    this.slug = slug
  }
}

export type PublishFilesResult =
  /** Nothing was ever published for this menu + venue: there is nothing to write. */
  | { readonly status: 'nothing_published' }
  | {
      readonly status: 'checked'
      readonly snapshotId: string
      readonly version: number
      /** The paths put to the store (empty when everything was there already). */
      readonly written: readonly string[]
      readonly slugIndex: SlugIndexStatus
      /** The slug the index is under. */
      readonly slug: string
    }

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** The id of the snapshot the pointer names now (a light read: no body). */
async function pointerId(deps: PublishFilesDeps, scope: PublishScope): Promise<string | null> {
  const [row] = await withTenant(deps.pool, scope.tenantId, (tx) =>
    tx
      .select({ id: publishPointers.currentSnapshotId })
      .from(publishPointers)
      .where(
        and(eq(publishPointers.menuId, scope.menuId), eq(publishPointers.venueId, scope.venueId)),
      ),
  )
  return row?.id ?? null
}

/** The slug of the venue (the address `/m/<slug>` lives under). */
async function slugOf(deps: PublishFilesDeps, scope: PublishScope): Promise<string> {
  const [row] = await withTenant(deps.pool, scope.tenantId, (tx) =>
    tx.select({ slug: venues.slug }).from(venues).where(eq(venues.id, scope.venueId)),
  )
  if (row === undefined) throw new Error(`there is no venue ${scope.venueId} to publish`)
  return row.slug
}

/**
 * Writes `v/<slug>.json` = {venue_id, menu_id} unless it is there already. A file that names
 * another venue is never overwritten and fails the job (`VenueAddressTakenError`); a file that
 * cannot be read is replaced.
 *
 * Defence in depth: since slugs became globally unique in the database, no two venues can hold
 * the same slug, so this only fires for a stale or foreign file in the store. By the time it
 * fires, `publishMenu` has already moved the pointer; that is acceptable, because the database
 * index prevents the case and the failure is loud (the run is recorded as failed and the job
 * fails, instead of the menu quietly not being served at its address).
 */
async function writeSlugIndex(
  deps: PublishFilesDeps,
  scope: PublishScope,
  slug: string,
): Promise<SlugIndexStatus> {
  const existing = await readVenueIndex(deps.store, slug)
  if (existing !== null && existing.venue_id !== scope.venueId) {
    throw new VenueAddressTakenError(slug)
  }
  const file = venueIndexPath(slug)
  const bytes = venueIndexBytes({ venue_id: scope.venueId, menu_id: scope.menuId })
  if (sameBytes(await deps.store.get(file), bytes)) return 'unchanged'
  await deps.store.put(file, bytes, publishPutOptions(file))
  return 'written'
}

/** How often the pointer is read again when it moved while the files were written. */
const MAX_ROUNDS = 4

/**
 * Writes the snapshot file (if missing) and `current.json` (if missing or different) for the
 * snapshot the database pointer names. After a rollback the pointer names an older snapshot, whose
 * file is normally there already; a missing one (a publish from before files existed) is written
 * from the stored body.
 *
 * The pointer can move while this runs (another publish, a rollback): it is read again after the
 * writes and, if it moved, the files are written again for the new target, so the last writer
 * always leaves the files matching the database.
 */
export async function writePublishFiles(
  deps: PublishFilesDeps,
  scope: PublishScope,
): Promise<PublishFilesResult> {
  const written: string[] = []
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const current = await loadCurrentSnapshot(deps.pool, scope.tenantId, {
      menuId: scope.menuId,
      venueId: scope.venueId,
    })
    if (current === null) return { status: 'nothing_published' }
    if (current.body === null) {
      throw new Error(`the pointer of ${scope.menuId} names a snapshot without a body`)
    }

    // The stored body, as loadSnapshot returns it: Postgres reorders keys inside jsonb, but order
    // lives in the arrays and the hash is canonical, so nothing depends on key order.
    const snapFile = snapshotPath(current.id)
    if ((await deps.store.get(snapFile)) === null) {
      await deps.store.put(snapFile, encode(current.body), publishPutOptions(snapFile))
      written.push(snapFile)
    }

    const pointerFile = currentPath(current.menuId, current.venueId)
    const pointer = encode({
      snapshot_id: current.id,
      version: current.version,
      hash: current.hash,
    })
    if (!sameBytes(await deps.store.get(pointerFile), pointer)) {
      await deps.store.put(pointerFile, pointer, publishPutOptions(pointerFile))
      written.push(pointerFile)
    }

    const slug = await slugOf(deps, scope)
    const slugIndex = await writeSlugIndex(deps, scope, slug)
    if (slugIndex === 'written') written.push(venueIndexPath(slug))

    if ((await pointerId(deps, scope)) === current.id) {
      return {
        status: 'checked',
        snapshotId: current.id,
        version: current.version,
        written,
        slugIndex,
        slug,
      }
    }
  }
  throw new Error(`the pointer of ${scope.menuId} kept moving while its files were written`)
}

export type LiveFilesResult =
  | { readonly status: 'nothing_published' }
  | {
      /** `unchanged`: the file in the store was the same, so nothing was put. */
      readonly status: 'written' | 'unchanged'
      /** The snapshot version the overlay was made for. */
      readonly version: number
      readonly soldOut: number
    }

/**
 * Writes `live.json`: the sold-out marks of the current snapshot's items, resolved with today's
 * service edition. Written only when it differs from the file in the store.
 */
export async function writeLiveOverlay(
  deps: PublishFilesDeps,
  scope: PublishScope,
): Promise<LiveFilesResult> {
  const live = await loadLiveOverlay(
    deps.pool,
    scope.tenantId,
    { menuId: scope.menuId, venueId: scope.venueId },
    { now: deps.now() },
  )
  if (live === null) return { status: 'nothing_published' }
  const file = livePath(scope.menuId, scope.venueId)
  const bytes = encode(live.overlay)
  const unchanged = sameBytes(await deps.store.get(file), bytes)
  if (!unchanged) await deps.store.put(file, bytes, publishPutOptions(file))
  return {
    status: unchanged ? 'unchanged' : 'written',
    version: live.overlay.version,
    soldOut: Object.keys(live.overlay.items).length,
  }
}
