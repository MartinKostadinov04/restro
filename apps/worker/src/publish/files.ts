// Writing what a publish decided into the publish store (brief S3-01b). `publishMenu` (core/apply)
// only moves rows in the database; these functions turn the current pointer into the files a guest
// page reads: `snap/<sn>.json`, `m/<menu>/<venue>/current.json` and `m/<menu>/<venue>/live.json`,
// and (S3-03, D68) the venue index `v/<venue public code>.json` = {venue_id, menu_id, slug} that
// `/m/<slug>-<code>` starts from. The slug in it is the venue's current one: the guest page
// corrects a stale address from it, so a rename needs only this file written again.
//
// Both are idempotent and safe to repeat, which is what makes `publish-files` a repair: they
// compare with what is in the store and write only what is missing or different. The snapshot
// file always goes first, so a reader that finds `current.json` never finds a pointer to a
// snapshot that is not there yet, and the venue index goes last, so a reader that finds it finds
// a menu that is published.
//
// A DELETED venue (D76, `venues.archived_at`) is withdrawn instead: its index `v/<code>.json` is removed,
// so `/m/<slug>-<code>` says the menu is not available (the guest page treats a missing index as an
// unknown venue). The snapshots, the pointer and the live overlay stay where they are: their paths
// hold random ids that only the index names, so nothing points at them. Whichever run is last leaves
// what the database says: a run looks at the venue before it writes anything and again after it
// wrote the index, and withdraws if the venue was deleted meanwhile, so a publish that started
// before the deletion cannot bring the page back. Restoring the venue and publishing writes the
// index again (the code is the same, so old links work).
//
// The older `v/<slug>.json` files of before CF-14 were test data. They are not migrated or
// removed: they stay in the store and nothing reads them again.
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
import { loadCurrentSnapshot, loadLiveOverlay, PublishError } from '@restro/core/apply'
import { authOrganization, type DbPool, publishPointers, venues, withTenant } from '@restro/db'
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

/** What happened to the venue index `v/<public code>.json`. */
export type VenueIndexStatus = 'written' | 'unchanged'

/**
 * `v/<public code>.json` names another venue, so this venue's code is not its own. The database
 * keeps public codes globally unique (`venues_public_id_unique`), so this means the store holds
 * a foreign or stale file; it is never overwritten, and the job fails so that someone looks.
 */
export class VenueCodeTakenError extends Error {
  override name = 'VenueCodeTakenError'
  readonly publicId: string

  constructor(publicId: string) {
    super(
      `the public code ${publicId} belongs to another venue (v/${publicId}.json names a different ` +
        'venue): the menu is not served there until the file is fixed',
    )
    this.publicId = publicId
  }
}

export type PublishFilesResult =
  /** Nothing was ever published for this menu + venue: there is nothing to write. */
  | { readonly status: 'nothing_published' }
  /**
   * The venue was deleted (D76): nothing was written, and its venue index was taken out of the
   * store (`removed`: false when there was none, or it names another venue and was left alone).
   */
  | {
      readonly status: 'withdrawn'
      readonly publicId: string
      readonly removed: boolean
    }
  | {
      readonly status: 'checked'
      readonly snapshotId: string
      readonly version: number
      /** The paths put to the store (empty when everything was there already). */
      readonly written: readonly string[]
      readonly venueIndex: VenueIndexStatus
      /** The public code the index is under. */
      readonly publicId: string
      /** The slug the index carries. */
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

/** What the venue's address is made of: its public code, its slug and its organisation's slug (D84). */
interface VenueAddress {
  readonly publicId: string
  readonly slug: string
  readonly organization: string | null
}

/** The venue's address parts (the old address `/m/<slug>-<code>` and the new `/m/<organisation>/<slug>`). */
async function addressOf(deps: PublishFilesDeps, scope: PublishScope): Promise<VenueAddress> {
  return withTenant(deps.pool, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({ publicId: venues.publicId, slug: venues.slug })
      .from(venues)
      .where(eq(venues.id, scope.venueId))
    if (row === undefined) throw new Error(`there is no venue ${scope.venueId} to publish`)
    const [organization] = await tx
      .select({ slug: authOrganization.slug })
      .from(authOrganization)
      .where(eq(authOrganization.id, scope.tenantId))
    return { ...row, organization: organization?.slug ?? null }
  })
}

/**
 * The public code of the venue when its files must not be out: deleted (archived, D76) or
 * unpublished (D86); null when it is live or missing.
 */
async function withdrawnCodeOf(
  deps: PublishFilesDeps,
  scope: PublishScope,
): Promise<string | null> {
  const [row] = await withTenant(deps.pool, scope.tenantId, (tx) =>
    tx
      .select({
        publicId: venues.publicId,
        archivedAt: venues.archivedAt,
        unpublishedAt: venues.unpublishedAt,
      })
      .from(venues)
      .where(eq(venues.id, scope.venueId)),
  )
  if (row === undefined) return null
  return row.archivedAt !== null || row.unpublishedAt !== null ? row.publicId : null
}

/**
 * Takes `v/<public code>.json` out of the store, so `/m/<slug>-<code>` stops finding the menu. A
 * file that names another venue is left alone (it is not ours to remove; writing refuses the same
 * case with `VenueCodeTakenError`); a file that cannot be read is under this venue's own code and
 * goes. Nothing there is not an error: a repeated job finds the work done.
 */
async function withdrawVenueIndex(
  deps: PublishFilesDeps,
  scope: PublishScope,
  publicId: string,
): Promise<PublishFilesResult> {
  const file = venueIndexPath(publicId)
  const bytes = await deps.store.get(file)
  if (bytes === null) return { status: 'withdrawn', publicId, removed: false }
  const index = await readVenueIndex(deps.store, publicId)
  if (index !== null && index.venue_id !== scope.venueId) {
    return { status: 'withdrawn', publicId, removed: false }
  }
  await deps.store.delete(file)
  return { status: 'withdrawn', publicId, removed: true }
}

/**
 * Writes `v/<public code>.json` = {venue_id, menu_id, slug} unless the store holds the same bytes.
 * A renamed venue has a different slug, so its index is written again (same path, new content). A
 * file that names another venue is never overwritten and fails the job (`VenueCodeTakenError`); a
 * file that cannot be read is replaced.
 *
 * Defence in depth: public codes are unique in the database, so this only fires for a stale or
 * foreign file in the store. By the time it fires, `publishMenu` has already moved the pointer;
 * that is acceptable, because the database index prevents the case and the failure is loud (the
 * run is recorded as failed and the job fails, instead of the menu quietly not being served at
 * its address).
 */
async function writeVenueIndex(
  deps: PublishFilesDeps,
  scope: PublishScope,
  address: VenueAddress,
): Promise<VenueIndexStatus> {
  const existing = await readVenueIndex(deps.store, address.publicId)
  if (existing !== null && existing.venue_id !== scope.venueId) {
    throw new VenueCodeTakenError(address.publicId)
  }
  const file = venueIndexPath(address.publicId)
  const bytes = venueIndexBytes({
    venue_id: scope.venueId,
    menu_id: scope.menuId,
    slug: address.slug,
    ...(address.organization === null ? {} : { organization: address.organization }),
  })
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
    // A deleted or unpublished venue has no files: withdraw before anything is written (D76, D86).
    const deletedBefore = await withdrawnCodeOf(deps, scope)
    if (deletedBefore !== null) return withdrawVenueIndex(deps, scope, deletedBefore)

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

    const address = await addressOf(deps, scope)
    const venueIndex = await writeVenueIndex(deps, scope, address)
    if (venueIndex === 'written') written.push(venueIndexPath(address.publicId))

    // The venue may have been deleted while the files were written: the index goes again, so the
    // last run leaves what the database says, whichever job it was (D76).
    const deletedAfter = await withdrawnCodeOf(deps, scope)
    if (deletedAfter !== null) return withdrawVenueIndex(deps, scope, deletedAfter)

    if ((await pointerId(deps, scope)) === current.id) {
      return {
        status: 'checked',
        snapshotId: current.id,
        version: current.version,
        written,
        venueIndex,
        publicId: address.publicId,
        slug: address.slug,
      }
    }
  }
  throw new Error(`the pointer of ${scope.menuId} kept moving while its files were written`)
}

export type LiveFilesResult =
  | { readonly status: 'nothing_published' }
  /** The venue was deleted (D76): the overlay is not made and no file is written. */
  | { readonly status: 'venue_archived' }
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
  let live: Awaited<ReturnType<typeof loadLiveOverlay>>
  try {
    live = await loadLiveOverlay(
      deps.pool,
      scope.tenantId,
      { menuId: scope.menuId, venueId: scope.venueId },
      { now: deps.now() },
    )
  } catch (error) {
    // A deleted venue has no overlay to write (D76); this is an answer, not a failure.
    if (error instanceof PublishError && error.code === 'venue_archived') {
      return { status: 'venue_archived' }
    }
    throw error
  }
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
