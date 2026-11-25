// Writers of the barsy side-tables (brief S2-03b): the venues of an installation (`barsy_venues`)
// and its places (`places`). Neither is the menu document, so they do not go through apply();
// only this folder may import the write side of the database.
//
// barsy ids (`bid`, `place_id`) stay in these tables (rule 3). The places are the till layer
// under the platform's areas and tables (D95): whenever they change, or a till venue is linked to
// a venue of ours, the mirror (`till-tables.ts`) brings that venue's areas and tables in line, in
// the same transaction, and each place points at its table (`places.table_id`).

import {
  type BarsyVenue,
  type DbPool,
  places,
  type Venue,
  barsyVenues as venueLinks,
} from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'

import type { LinkStateName } from '../change-set'
import { isId, newId } from '../ids'
import { type AbsenceHeld, absenceHold } from '../sync/absence-hold'
import { concludeFullPull } from '../sync/conclude-full-pull'
import { lockTenantDocument } from './lock'
import {
  ProvisionError,
  type ProvisionVenueInput,
  provisionMenuIn,
  provisionVenueIn,
} from './provision'
import { mirrorTillTables } from './till-tables'
import { lockLiveVenue } from './venue-lock'

/**
 * Mirrors the stored places of one till venue into the areas and tables of the venue it serves
 * (D95), and points each place at its table. Nothing happens for a till venue that serves no
 * venue. Returns the tokens of the tables the mirror archived (their files must go).
 */
export async function mirrorTillVenueIn(
  tx: WriteTx,
  tenantId: string,
  integrationId: string,
  bid: number,
  now: Date,
): Promise<readonly string[]> {
  const [link] = await tx
    .select({ venueId: venueLinks.venueId })
    .from(venueLinks)
    .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
  if (link === undefined || link.venueId === null) return []
  const rows = await tx
    .select()
    .from(places)
    .where(and(eq(places.integrationId, integrationId), eq(places.bid, bid)))
  const mirrored = await mirrorTillTables(tx, {
    tenantId,
    venueId: link.venueId,
    now,
    places: rows.map((row) => ({
      id: row.id,
      placeNum: row.placeNum,
      salonId: row.salonId,
      salonWeight: row.salonWeight,
      salonName: row.salonName,
      isPublic: row.isPublic,
      state: row.state as LinkStateName,
      tableId: row.tableId,
    })),
  })
  for (const [placeId, tableId] of mirrored.linked) {
    await tx.update(places).set({ tableId }).where(eq(places.id, placeId))
  }
  return mirrored.retiredTokens
}

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
  /**
   * The catalogue it sells from (`menu_id`; brief CF-16). Null or absent: not reported, and a
   * catalogue stored earlier is kept.
   */
  readonly catalogueId?: number | null
  /**
   * The roots the till designates for the venue's menus (D88): its public menu's category
   * (`public_cat_id`) and its till tree's (`cat_id`). Null or absent: not reported, and a root
   * stored earlier is kept.
   */
  readonly publicCatId?: number | null
  readonly treeCatId?: number | null
}

/**
 * Records the venues of an installation: a new `bid` gets a row, a known one follows the name and
 * the catalogue barsy shows (a catalogue barsy does not report keeps the stored one). What the
 * manager chose (our venue, the catalogue root, the price) is never touched. A venue barsy no
 * longer lists keeps its row (the app role cannot delete; the manager unmaps it).
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
    for (const [name, value] of [
      ['catalogue', venue.catalogueId],
      ['public root', venue.publicCatId],
      ['tree root', venue.treeCatId],
    ] as const) {
      if (value != null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new ProvisionError('invalid_input', `a ${name} id is a non-negative integer`)
      }
    }
  }
  if (venues.length === 0) return []
  return withTenantWrite(pool, tenantId, (tx) =>
    tx
      .insert(venueLinks)
      .values(
        venues.map((venue) => ({
          tenantId,
          integrationId,
          bid: venue.bid,
          name: venue.name.trim(),
          catalogueId: venue.catalogueId ?? null,
          publicCatId: venue.publicCatId ?? null,
          treeCatId: venue.treeCatId ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [venueLinks.integrationId, venueLinks.bid],
        set: {
          name: sql`excluded.name`,
          catalogueId: sql`coalesce(excluded.catalogue_id, ${venueLinks.catalogueId})`,
          publicCatId: sql`coalesce(excluded.public_cat_id, ${venueLinks.publicCatId})`,
          treeCatId: sql`coalesce(excluded.tree_cat_id, ${venueLinks.treeCatId})`,
        },
      })
      .returning(),
  )
}

/** Why a venue mapping or a catalogue-root choice was refused. */
export type BarsyVenueChoiceError =
  /** The integration has no barsy venue with this `bid` (or it belongs to another tenant). */
  | 'barsy_venue_missing'
  /** The tenant has no venue with this id. */
  | 'venue_missing'
  /** The venue was deleted (archived, D76): a till venue is never mapped to it. */
  | 'venue_archived'
  /** The barsy venue is mapped to another venue of ours already. */
  | 'barsy_venue_taken'
  /** `venueMustBeUnlinked` was asked for and the venue serves another barsy venue already. */
  | 'venue_already_linked'

/** What `mapBarsyVenue` and `setCatalogueRoot` answer. */
export type BarsyVenueChoice =
  | { readonly ok: true; readonly row: BarsyVenue }
  | { readonly ok: false; readonly error: BarsyVenueChoiceError }

/**
 * Maps one barsy venue of an integration to one of our venues (the Integration tab's picker).
 * One barsy venue per venue and one venue per barsy venue: a barsy venue that serves another
 * venue of ours is refused (`barsy_venue_taken`); a venue that was mapped to a different barsy
 * venue is moved to this one (that one is freed). Mapping the same pair again changes nothing.
 * The catalogue root of the barsy venue is kept.
 *
 * With `venueMustBeUnlinked` a venue that serves another barsy venue already is refused
 * (`venue_already_linked`) instead of being moved: Settings -> Integrations only links venues that
 * have no link yet; moving a venue is the deliberate "Change…" of its own Menu source card.
 */
export async function mapBarsyVenue(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  venueId: string,
  options: { readonly venueMustBeUnlinked?: boolean } = {},
): Promise<BarsyVenueChoice> {
  checked(tenantId, integrationId)
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [row] = await tx
      .select()
      .from(venueLinks)
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
    if (!row) return { ok: false, error: 'barsy_venue_missing' } as const
    // A till venue is never mapped to a deleted venue (D76); the lock keeps a deletion from
    // landing between this check and the link below.
    const locked = await lockLiveVenue(tx, venueId)
    if (locked.refused !== null) return { ok: false, error: locked.refused } as const
    if (row.venueId !== null && row.venueId !== venueId) {
      return { ok: false, error: 'barsy_venue_taken' } as const
    }
    if (row.venueId === venueId) return { ok: true, row } as const
    if (options.venueMustBeUnlinked === true) {
      const [other] = await tx
        .select({ bid: venueLinks.bid })
        .from(venueLinks)
        .where(eq(venueLinks.venueId, venueId))
        .limit(1)
      if (other) return { ok: false, error: 'venue_already_linked' } as const
    }
    // The venue may serve another barsy venue now (unique on venue_id): free that one first.
    await tx
      .update(venueLinks)
      .set({ venueId: null, updatedAt: new Date() })
      .where(eq(venueLinks.venueId, venueId))
    const [updated] = await tx
      .update(venueLinks)
      .set({ venueId, updatedAt: new Date() })
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
      .returning()
    if (!updated) return { ok: false, error: 'barsy_venue_missing' } as const
    // The venue's tables are the till venue's places from now on (D95).
    await mirrorTillVenueIn(tx, tenantId, integrationId, bid, new Date())
    return { ok: true, row: updated } as const
  })
}

/** What `addVenueFromTillVenue` answers. */
export type AddedVenue =
  | { readonly ok: true; readonly venue: Venue }
  | { readonly ok: false; readonly error: 'link_missing' | 'link_taken' }

/**
 * "Add as venue" (CF-09b, D73): makes a venue of ours for a barsy venue that has none, with its
 * empty menu, and links the two, all in ONE transaction under the tenant's document lock. Either
 * all three happen or none does, and two requests for the same barsy venue cannot make two
 * venues: the second finds the link and is refused (`link_taken`). The venue gets
 * `provisionVenue`'s checks, public code and defaults; `input` carries its name and slug.
 * The catalogue root is not chosen here: the person picks the menu category next.
 */
export async function addVenueFromTillVenue(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  input: ProvisionVenueInput,
): Promise<AddedVenue> {
  checked(tenantId, integrationId)
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [row] = await tx
      .select()
      .from(venueLinks)
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
      .for('update')
    if (!row) return { ok: false, error: 'link_missing' } as const
    if (row.venueId !== null) return { ok: false, error: 'link_taken' } as const
    const venue = await provisionVenueIn(tx, tenantId, input)
    await provisionMenuIn(tx, tenantId, venue.id)
    await tx
      .update(venueLinks)
      .set({ venueId: venue.id, updatedAt: new Date() })
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
    // Places read before the venue existed become its areas and tables now (D95).
    await mirrorTillVenueIn(tx, tenantId, integrationId, bid, new Date())
    return { ok: true, venue } as const
  })
}

/**
 * Records which category of the barsy venue's public tree is the root of this menu (D56), or
 * clears the choice with `null`. Whether the category exists in the cached tree is the caller's
 * check (the tree lives in the integration's config).
 */
export async function setCatalogueRoot(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  catId: number | null,
): Promise<BarsyVenueChoice> {
  checked(tenantId, integrationId)
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
  if (catId !== null && (!Number.isSafeInteger(catId) || catId < 0)) {
    throw new ProvisionError('invalid_input', 'catId must be a non-negative integer')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const [row] = await tx
      .update(venueLinks)
      .set({ catalogueRootCatId: catId, updatedAt: new Date() })
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
      .returning()
    return row
      ? ({ ok: true, row } as const)
      : ({ ok: false, error: 'barsy_venue_missing' } as const)
  })
}

/** Which till price a venue's menu shows (D73: per venue). */
export type VenuePriceSource = 'actual_price' | 'current_price'

/**
 * Records which till price the menu of the venue linked to `bid` shows (brief CF-16, D73): per
 * venue, because prices differ per venue. Returns whether the link exists. The next pull of that
 * venue reads it (a changed price source makes the change check ask for a full pull).
 */
export async function setVenuePriceSource(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  priceSource: VenuePriceSource,
): Promise<boolean> {
  checked(tenantId, integrationId)
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
  if (priceSource !== 'actual_price' && priceSource !== 'current_price') {
    throw new ProvisionError('invalid_input', 'priceSource must be actual_price or current_price')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(venueLinks)
      .set({ priceSource, updatedAt: new Date() })
      .where(and(eq(venueLinks.integrationId, integrationId), eq(venueLinks.bid, bid)))
      .returning({ bid: venueLinks.bid })
    return rows.length > 0
  })
}

/**
 * Forgets what the manager chose for every barsy venue of an integration (our venue and the
 * catalogue root). A new host is a different installation: the old choices mean nothing there.
 */
export async function clearBarsyVenueChoices(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
): Promise<number> {
  checked(tenantId, integrationId)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(venueLinks)
      .set({ venueId: null, catalogueRootCatId: null, updatedAt: new Date() })
      .where(eq(venueLinks.integrationId, integrationId))
      .returning({ bid: venueLinks.bid })
    return rows.length
  })
}

/** A place (table) as the mapping describes it. */
export interface PlaceInput {
  /** barsy's `place_id` as text. */
  readonly placeId: string
  readonly placeNum: string | null
  readonly salonName: string | null
  /** The till's hall id and its order among halls (D95). Absent or null: not reported. */
  readonly salonId?: string | null
  readonly salonWeight?: number | null
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
  /**
   * The QR tokens of the tables this run archived (D95): those of places concluded `deleted`,
   * and those the till venue's places no longer point to. The caller queues the token job so
   * their files (`t/<code hash>.json`, `codeFileNames`) are removed too.
   */
  readonly retiredTokens: readonly string[]
  /**
   * Set when the pull was complete but its absence conclusion was held back because the list was
   * empty or far smaller than what is stored: nothing was concluded (T62). Null otherwise.
   */
  readonly held: AbsenceHeld | null
}

/**
 * Stores the places of one barsy venue. New ones get a `tb_` id; known ones follow barsy's
 * number, salon and public flag. Absence follows rule 6 like every other link: places the pull
 * did not list become `missing` only when `pagesOk` says the pull was complete, and `deleted`
 * after the usual grace period (`concludeFullPull`); a place that is listed again is `active`.
 * Even then a read that lists no place, or would mark more than 30% (and at least 5) of the
 * active ones missing, is held (`absenceHold`): no place goes `missing` or `deleted`, no token is
 * retired, and `held` says why. Listed places are still stored and brought back to `active`.
 * The venue's areas and tables follow in the same transaction (`mirrorIn`, D95): a place
 * concluded `deleted` archives its table and loses its code (returned in `retiredTokens`), since
 * its sticker must stop working.
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
      const salonId = place.salonId ?? null
      const salonWeight = place.salonWeight ?? null
      if (!row) {
        await tx.insert(places).values({
          id: newId('tb'),
          tenantId,
          integrationId,
          bid,
          placeId: place.placeId,
          placeNum: place.placeNum,
          salonName: place.salonName,
          salonId,
          salonWeight,
          isPublic: place.isPublic,
        })
        created += 1
        continue
      }
      const same =
        row.placeNum === place.placeNum &&
        row.salonName === place.salonName &&
        row.salonId === salonId &&
        row.salonWeight === salonWeight &&
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
          salonId,
          salonWeight,
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
    // A complete read that lists nothing, or far less than we hold, concludes nothing (T62).
    // TODO(T62 preview): a person releases a hold from the switch preview; the override plugs in here.
    const activeBefore = stored.filter((row) => row.state === 'active').length
    const wouldGoMissing = conclusion.changes.filter((change) => change.to === 'missing').length
    const verdict = absenceHold({ activeBefore, seen: seen.size, wouldGoMissing })
    const held: AbsenceHeld | null = verdict.hold
      ? { reason: verdict.reason, wouldHide: wouldGoMissing, active: activeBefore }
      : null

    let missing = 0
    let deleted = 0
    for (const change of conclusion.changes) {
      if (change.to === 'active') continue // listed again: handled above
      if (held !== null) continue // held: nothing goes missing or deleted, no token is retired
      const row = byPlaceId.get(change.key)
      if (!row) continue
      // A table barsy deleted no longer exists: the mirror archives it and its sticker stops
      // leading anywhere. A merely `missing` table keeps its code, since it may be listed again.
      await tx.update(places).set({ state: change.to, updatedAt: now }).where(eq(places.id, row.id))
      if (change.to === 'deleted') deleted += 1
      else missing += 1
    }
    const retiredTokens = await mirrorTillVenueIn(tx, tenantId, integrationId, bid, now)
    return {
      created,
      updated,
      unchanged,
      missing,
      deleted,
      reactivated,
      complete: conclusion.complete,
      retiredTokens,
      held,
    }
  })
}
