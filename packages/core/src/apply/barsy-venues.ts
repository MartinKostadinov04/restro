// Writers of the barsy side-tables (brief S2-03b): the venues of an installation (`barsy_venues`)
// and its places (`places`, the tables). Neither is the menu document, so they do not go through
// apply(); only this folder may import the write side of the database.
//
// barsy ids (`bid`, `place_id`) stay in these tables (rule 3).

import { type BarsyVenue, barsyVenues, type DbPool, places } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'

import type { LinkStateName } from '../change-set'
import { isId, newId } from '../ids'
import { concludeFullPull } from '../sync/conclude-full-pull'
import { ProvisionError } from './provision'

function checked(tenantId: string, integrationId: string): void {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
}

/** A venue as `Barsys_getlist` reports it. */
export interface BarsyVenueInput {
  readonly bid: number
  readonly name: string
}

/**
 * Records the venues of an installation: a new `bid` gets a row, a known one only follows the
 * name barsy shows. What the manager chose (our venue, the catalogue root) is never touched. A
 * venue barsy no longer lists keeps its row (the app role cannot delete; the manager unmaps it).
 */
export async function upsertBarsyVenues(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  venues: readonly BarsyVenueInput[],
): Promise<BarsyVenue[]> {
  checked(tenantId, integrationId)
  for (const venue of venues) {
    if (!Number.isSafeInteger(venue.bid) || venue.bid < 0 || venue.name.trim() === '') {
      throw new ProvisionError('invalid_input', 'a barsy venue needs a non-negative bid and a name')
    }
  }
  if (venues.length === 0) return []
  return withTenantWrite(pool, tenantId, (tx) =>
    tx
      .insert(barsyVenues)
      .values(
        venues.map((venue) => ({
          tenantId,
          integrationId,
          bid: venue.bid,
          name: venue.name.trim(),
        })),
      )
      .onConflictDoUpdate({
        target: [barsyVenues.integrationId, barsyVenues.bid],
        set: { name: sql`excluded.name` },
      })
      .returning(),
  )
}

/** A place (table) as the mapping describes it. */
export interface PlaceInput {
  /** barsy's `place_id` as text. */
  readonly placeId: string
  readonly placeNum: string | null
  readonly salonName: string | null
  readonly isPublic: boolean
}

/** What `upsertPlaces` did. */
export interface UpsertPlacesResult {
  readonly created: number
  readonly updated: number
  readonly unchanged: number
  /** Active places that this complete pull did not list. */
  readonly missing: number
  /** Missing places that stayed missing for the whole grace period. */
  readonly deleted: number
  /** Missing or deleted places that were listed again. */
  readonly reactivated: number
  /** False when a page failed: no place was concluded missing or deleted (rule 6). */
  readonly complete: boolean
}

/**
 * Stores the places of one barsy venue. New ones get a `tb_` id; known ones follow barsy's
 * number, salon and public flag. Absence follows rule 6 like every other link: places the pull
 * did not list become `missing` only when `pagesOk` says the pull was complete, and `deleted`
 * after the usual grace period (`concludeFullPull`); a place that is listed again is `active`.
 * A place's own `qr_token` is never touched.
 *
 * `places` has no `state_changed_at`; a row is written only when something about it changes, so
 * `updated_at` of a missing place is when it went missing.
 */
export async function upsertPlaces(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  listed: readonly PlaceInput[],
  evidence: { readonly pagesOk: readonly boolean[]; readonly now?: Date },
): Promise<UpsertPlacesResult> {
  checked(tenantId, integrationId)
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
  const now = evidence.now ?? new Date()
  return withTenantWrite(pool, tenantId, async (tx) => {
    const stored = await tx
      .select()
      .from(places)
      .where(and(eq(places.integrationId, integrationId), eq(places.bid, bid)))
    const byPlaceId = new Map(stored.map((row) => [row.placeId, row]))
    const seen = new Set<string>()
    let created = 0
    let updated = 0
    let unchanged = 0
    let reactivated = 0

    for (const place of listed) {
      if (seen.has(place.placeId)) continue
      seen.add(place.placeId)
      const row = byPlaceId.get(place.placeId)
      if (!row) {
        await tx.insert(places).values({
          id: newId('tb'),
          tenantId,
          integrationId,
          bid,
          placeId: place.placeId,
          placeNum: place.placeNum,
          salonName: place.salonName,
          isPublic: place.isPublic,
        })
        created += 1
        continue
      }
      const same =
        row.placeNum === place.placeNum &&
        row.salonName === place.salonName &&
        row.isPublic === place.isPublic &&
        row.state === 'active'
      if (same) {
        unchanged += 1
        continue
      }
      if (row.state !== 'active') reactivated += 1
      else updated += 1
      await tx
        .update(places)
        .set({
          placeNum: place.placeNum,
          salonName: place.salonName,
          isPublic: place.isPublic,
          state: 'active',
          updatedAt: now,
        })
        .where(eq(places.id, row.id))
    }

    // Absence: the same pure rule as for every other link.
    const conclusion = concludeFullPull({
      pagesOk: evidence.pagesOk,
      seen,
      deletedSeen: new Set(),
      links: stored.map((row) => ({
        key: row.placeId,
        state: row.state as LinkStateName,
        stateChangedAt: row.updatedAt,
      })),
      now,
    })
    let missing = 0
    let deleted = 0
    for (const change of conclusion.changes) {
      if (change.to === 'active') continue // listed again: handled above
      const row = byPlaceId.get(change.key)
      if (!row) continue
      await tx.update(places).set({ state: change.to, updatedAt: now }).where(eq(places.id, row.id))
      if (change.to === 'missing') missing += 1
      else deleted += 1
    }
    return {
      created,
      updated,
      unchanged,
      missing,
      deleted,
      reactivated,
      complete: conclusion.complete,
    }
  })
}
