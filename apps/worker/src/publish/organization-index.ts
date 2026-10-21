// The organisation's index on the CDN (D84, D86): `o/<organisation slug>.json` lists the
// organisation's venues that guests may see, by address name, with each venue's internal code and
// live menu, and the earlier names of its venues; `o/<earlier organisation slug>.json` says where
// the organisation went. The guest page starts from these files for `/m/<organisation>/<venue>`
// and never reads the database (rule 4). Written after every publish and after every change that
// moves a venue in or out of the list or renames something (the `publish-organization-index` job);
// idempotent: each file is put only when its bytes differ. Nothing is ever removed here: an
// earlier organisation slug keeps its redirect for as long as the history remembers it, and a
// venue that leaves the list is simply not in the next index.
//
// A venue is listed when it is live (D86): not deleted, not unpublished, and its live menu has a
// published version; the index writer and the state function in core agree on that.
import {
  organizationFileBytes,
  organizationIndexPath,
  type PublishStore,
  publishPutOptions,
} from '@restro/assets'
import {
  type NodeId,
  type OrganizationIndex,
  type TenantId,
  type VenueId,
  venueStateOf,
} from '@restro/core'
import { organizationAddressIn } from '@restro/core/apply'
import { type DbPool, publishPointers, venueSlugHistory, venues, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'

export interface OrganizationIndexDeps {
  readonly pool: DbPool
  readonly store: PublishStore
}

export type OrganizationIndexResult =
  /** There is no such organisation: nothing was written. */
  | { readonly status: 'unknown_organization' }
  | {
      readonly status: 'done'
      /** The organisation's current slug: the index is under it. */
      readonly slug: string
      /** How many venues the index lists. */
      readonly venues: number
      /** The paths put to the store (empty when every file was already right). */
      readonly written: readonly string[]
    }

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** What the index says, read from the database in one transaction. */
async function buildIndex(
  deps: OrganizationIndexDeps,
  tenantId: string,
): Promise<{ index: OrganizationIndex; oldSlugs: readonly string[] } | null> {
  return withTenant(deps.pool, tenantId, async (tx) => {
    const address = await organizationAddressIn(tx, tenantId)
    if (address === null) return null
    const rows = await tx
      .select({
        id: venues.id,
        slug: venues.slug,
        publicId: venues.publicId,
        liveMenuId: venues.liveMenuId,
        archivedAt: venues.archivedAt,
        unpublishedAt: venues.unpublishedAt,
        publishedMenuId: publishPointers.menuId,
      })
      .from(venues)
      .leftJoin(
        publishPointers,
        and(eq(publishPointers.venueId, venues.id), eq(publishPointers.menuId, venues.liveMenuId)),
      )
      .where(isNull(venues.archivedAt))
    const listed: OrganizationIndex['venues'] = {}
    const currentSlugs = new Set<string>()
    for (const row of rows) {
      currentSlugs.add(row.slug)
      const state = venueStateOf({
        archivedAt: row.archivedAt,
        unpublishedAt: row.unpublishedAt,
        livePublished: row.publishedMenuId !== null,
      })
      if (state !== 'live' || row.liveMenuId === null) continue
      listed[row.slug] = {
        venue_id: row.id as VenueId,
        menu_id: row.liveMenuId as NodeId,
        public_id: row.publicId,
      }
    }
    // Earlier venue names lead to the venue's current name, when that venue is listed; a name a
    // venue has now is nobody's earlier name.
    const history = await tx
      .select({ slug: venueSlugHistory.slug, venueId: venueSlugHistory.venueId })
      .from(venueSlugHistory)
    const slugOf = new Map(rows.map((row) => [row.id, row.slug]))
    const oldNames: Record<string, string> = {}
    for (const entry of history) {
      if (currentSlugs.has(entry.slug)) continue
      const current = slugOf.get(entry.venueId)
      if (current === undefined || !(current in listed)) continue
      oldNames[entry.slug] = current
    }
    const index: OrganizationIndex = {
      organization_id: tenantId as TenantId,
      slug: address.slug,
      venues: Object.fromEntries(Object.entries(listed).sort(([a], [b]) => (a < b ? -1 : 1))),
      old_names: Object.fromEntries(Object.entries(oldNames).sort(([a], [b]) => (a < b ? -1 : 1))),
    }
    return { index, oldSlugs: address.oldSlugs }
  })
}

/** Brings the organisation's `o/…json` files in line with the database; see the header. */
export async function writeOrganizationIndex(
  deps: OrganizationIndexDeps,
  tenantId: string,
): Promise<OrganizationIndexResult> {
  const built = await buildIndex(deps, tenantId)
  if (built === null) return { status: 'unknown_organization' }
  const written: string[] = []
  const put = async (path: string, bytes: Uint8Array) => {
    if (sameBytes(await deps.store.get(path), bytes)) return
    await deps.store.put(path, bytes, publishPutOptions(path))
    written.push(path)
  }
  await put(organizationIndexPath(built.index.slug), organizationFileBytes(built.index))
  for (const old of built.oldSlugs) {
    await put(organizationIndexPath(old), organizationFileBytes({ redirect_to: built.index.slug }))
  }
  return {
    status: 'done',
    slug: built.index.slug,
    venues: Object.keys(built.index.venues).length,
    written,
  }
}
