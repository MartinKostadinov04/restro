// The floor reading's writer (ticket #71; spec #64 Implementation Decisions 3 and 7; D122 §7, §8;
// D124 §1): the integration layer's mirror that turns what a connector's `readFloor` reported into
// the venue's `bars` and `tables` (their `bar_id` and `is_payment_table`), beside
// `till-tables.ts`, through `apply()` and never through `applyService` (the floor is menu-side,
// the write-target guard pins it). It is the sim's and any later POS's counterpart of the places
// read: the connector's own rows (`places`, with the POS's ids, rule 3) are written here, and the
// areas and tables follow through `mirrorTillTables`, so nothing else about a table's life changes.
//
// Rules:
// - A reading that is not complete concludes nothing and writes nothing (rule 6, D122 §6). The
//   caller passes the connector's `Reading`; the refusal is made here so no caller can forget it.
// - A table the reading no longer lists is marked `missing`, never deleted, never archived, and
//   its code stays: its open sitting pauses rather than ends (verification, platform row 20), which
//   the caller does through `applyService`, with the ids this returns. One that is listed again
//   comes back `active` (and is returned so the pause can lift). Even a complete reading that lists
//   nothing, or far less than we hold, is held and marks nothing (the same net as the places read,
//   T62).
// - A bar is optional (D124 §1): only bars the POS reports are written, never a made-up one; a
//   table whose POS says no bar has `bar_id` null. A bar the reading no longer lists is archived,
//   never deleted. A bar's name follows the POS (it is never edited in Restro).
// - The venue serves the part of the floor its `floor_source` picks (two venues may share one POS
//   instance). A table another venue of the instance already serves is skipped, so a payment table
//   belongs to one venue only.
// - `is_payment_table` follows a POS that marks its own; for one that does not, the venue's source
//   names the tables to mark when they first appear (D122 §8: marked once; a manager's later mark
//   stays). A table marked a payment table becomes hidden: it gets no code and no guest page.
// - Provenance (rule 2): the tables have no provenance columns, so the run is the provenance: the
//   caller passes the `jb_` id of its job run, which this checks and returns.
// - What the connector declared (`capabilities`, D122 §3) is recorded with a complete reading in
//   `integrations.config.service_capabilities` (#78), so the service path and the guest API can
//   read it without a connector: merged into the config inside this transaction, the other keys
//   (`sync`…) untouched, and only when it changed.

import { bars, type DbPool, integrations, venues, venueTables } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { LinkStateName } from '../change-set'
import {
  type Floor,
  FloorSchema,
  type Reading,
  type ServiceCapabilities,
  ServiceCapabilitiesSchema,
} from '../connectors/service'
import { tillPlaces, tillVenueLinks } from '../connectors/till-venues'
import {
  type FloorSource,
  FloorSourceSchema,
  inFloorSource,
  readFloorSource,
} from '../floor-source'
import { isId, newId } from '../ids'
import {
  SERVICE_CAPABILITIES_CONFIG_KEY,
  storedServiceCapabilities,
} from '../service-capabilities-config'
import { absenceHold } from '../sync/absence-hold'
import { lockTenantDocument } from './lock'
import { mirrorTillTables } from './till-tables'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Longest table number the platform keeps (`tables.number`). */
const MAX_NUMBER = 40
/** Longest bar name and bar key the platform keeps. */
const MAX_BAR_NAME = 60
const MAX_BAR_KEY = 128

/** What `applyFloor` takes. */
export interface ApplyFloorInput {
  readonly integrationId: string
  /** The till venue (`bid`) of the instance the venue serves: the link names our venue. */
  readonly bid: number
  /** The `jb_` id of the job run this write belongs to (rule 2). */
  readonly jobId: string
  /** What the connector's `readFloor` answered. */
  readonly reading: Reading<Floor>
  /** What the connector declares (`connector.capabilities`): recorded with a complete reading. */
  readonly capabilities?: ServiceCapabilities
  readonly now?: Date
}

/** What a floor reading did. */
export type FloorApplied =
  /** The reading was not complete: nothing was concluded, nothing was written (rule 6). */
  | { readonly kind: 'incomplete'; readonly reason: string }
  /** The till venue serves no venue of ours (or the venue is gone): nothing to mirror into. */
  | { readonly kind: 'not_linked'; readonly reason: string }
  | {
      readonly kind: 'applied'
      readonly venueId: string
      readonly jobId: string
      /** The tables this venue serves that the reading listed. */
      readonly listed: number
      readonly tablesCreated: number
      readonly tablesUpdated: number
      /** Table ids newly marked missing: their open sittings pause (never end). */
      readonly vanished: readonly string[]
      /** Table ids listed again after being missing: their pause lifts. */
      readonly returned: readonly string[]
      /** Set when the reading's absence conclusion was held back (an empty or far smaller floor). */
      readonly held: { readonly reason: string; readonly wouldHide: number } | null
      readonly barsCreated: number
      readonly barsArchived: number
      /** Tables of the reading another venue of the instance serves: skipped. */
      readonly skippedClaimed: number
      /** Bars the platform cannot key (a key over 128 characters): left out, their tables have none. */
      readonly barsSkipped: number
      /** The codes of tables the mirror archived (their files must go). */
      readonly retiredTokens: readonly string[]
      /** The connector's declaration was recorded because it changed (#78). */
      readonly capabilitiesRecorded: boolean
    }

function cut(text: string, length: number): string {
  return text.slice(0, length).trim()
}

/**
 * Writes one complete floor reading into the venue the till venue serves (see the header). Safe to
 * repeat: the same reading changes nothing.
 */
export async function applyFloor(
  pool: DbPool,
  tenantId: string,
  input: ApplyFloorInput,
): Promise<FloorApplied> {
  if (!isId('tn', tenantId)) throw new TypeError('tenantId must be a tn_ id')
  if (!Number.isSafeInteger(input.bid) || input.bid < 0)
    throw new TypeError('bid must be a non-negative integer')
  if (!isId('in', input.integrationId)) throw new TypeError('integrationId must be an in_ id')
  if (!isId('jb', input.jobId)) throw new TypeError('jobId must be a jb_ id')
  // Rule 6: an incomplete reading is refused here, before the database is asked.
  if (!input.reading.complete) return { kind: 'incomplete', reason: input.reading.reason }
  const floor = FloorSchema.parse(input.reading.value)
  const capabilities =
    input.capabilities === undefined ? null : ServiceCapabilitiesSchema.parse(input.capabilities)
  const now = input.now ?? new Date()

  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const [link] = await tx
      .select()
      .from(tillVenueLinks)
      .where(
        and(
          eq(tillVenueLinks.integrationId, input.integrationId),
          eq(tillVenueLinks.bid, input.bid),
        ),
      )
      .for('update')
    if (link === undefined) return { kind: 'not_linked', reason: 'no such till venue' } as const
    if (link.venueId === null) {
      return { kind: 'not_linked', reason: 'the till venue serves no venue' } as const
    }
    const venueId = link.venueId
    const locked = await lockLiveVenue(tx, venueId)
    if (locked.refused !== null) {
      return { kind: 'not_linked', reason: venueRefusalText(venueId, locked.refused) } as const
    }
    const source = readFloorSource(locked.venue.settings)

    // The part of the floor this venue serves, less what another venue of the instance serves.
    const serving = floor.tables.filter((table) =>
      inFloorSource(source, { area: table.area, bar: table.bar?.pos ?? null }),
    )
    const claimed = await claimedElsewhere(
      tx,
      input.integrationId,
      input.bid,
      serving.map((table) => table.ref.pos),
    )
    const listedTables = serving.filter((table) => !claimed.has(table.ref.pos))

    const placeResult = await writePlaces(tx, tenantId, input, listedTables, now)
    const mirror = await mirrorPlaces(tx, tenantId, venueId, input, now)
    const tableOf = new Map(
      (
        await tx
          .select({ placeId: tillPlaces.placeId, tableId: tillPlaces.tableId })
          .from(tillPlaces)
          .where(
            and(eq(tillPlaces.integrationId, input.integrationId), eq(tillPlaces.bid, input.bid)),
          )
      ).map((row) => [row.placeId, row.tableId]),
    )

    const barResult = await writeBars(tx, tenantId, venueId, floor, listedTables, source, {
      hold: placeResult.held !== null,
      now,
    })
    await writeTableFacts(tx, listedTables, tableOf, barResult.ids, mirror.created, source)
    const capabilitiesRecorded =
      capabilities !== null && (await recordCapabilities(tx, input.integrationId, capabilities))

    return {
      kind: 'applied',
      venueId,
      jobId: input.jobId,
      listed: listedTables.length,
      tablesCreated: placeResult.created,
      tablesUpdated: placeResult.updated,
      vanished: placeResult.vanished,
      returned: placeResult.returned,
      held: placeResult.held,
      barsCreated: barResult.created,
      barsArchived: barResult.archived,
      skippedClaimed: serving.length - listedTables.length,
      barsSkipped: barResult.skipped,
      retiredTokens: mirror.retiredTokens,
      capabilitiesRecorded,
    } as const
  })
}

/**
 * Records the connector's declaration in `integrations.config.service_capabilities`: one atomic
 * merge that leaves the other keys alone, and no write when the stored value is the same.
 */
async function recordCapabilities(
  tx: WriteTx,
  integrationId: string,
  capabilities: ServiceCapabilities,
): Promise<boolean> {
  const stored = JSON.stringify(storedServiceCapabilities(capabilities))
  const rows = await tx
    .update(integrations)
    .set({
      config: sql`${integrations.config} || jsonb_build_object(${SERVICE_CAPABILITIES_CONFIG_KEY}::text, ${stored}::jsonb)`,
    })
    .where(
      and(
        eq(integrations.id, integrationId),
        sql`${integrations.config} -> ${SERVICE_CAPABILITIES_CONFIG_KEY}::text is distinct from ${stored}::jsonb`,
      ),
    )
    .returning({ id: integrations.id })
  return rows.length > 0
}

/** The POS ids (of `candidates`) another till venue of the same instance already serves. */
async function claimedElsewhere(
  tx: WriteTx,
  integrationId: string,
  bid: number,
  candidates: readonly string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()
  const rows = await tx
    .select({ placeId: tillPlaces.placeId })
    .from(tillPlaces)
    .where(
      and(
        eq(tillPlaces.integrationId, integrationId),
        ne(tillPlaces.bid, bid),
        inArray(tillPlaces.placeId, [...candidates]),
        ne(tillPlaces.state, 'deleted'),
      ),
    )
  return new Set(rows.map((row) => row.placeId))
}

/** Stores the listed places; marks the unlisted ones missing unless the conclusion is held. */
async function writePlaces(
  tx: WriteTx,
  tenantId: string,
  input: ApplyFloorInput,
  listed: Floor['tables'],
  now: Date,
) {
  const stored = await tx
    .select()
    .from(tillPlaces)
    .where(and(eq(tillPlaces.integrationId, input.integrationId), eq(tillPlaces.bid, input.bid)))
  const byPlaceId = new Map(stored.map((row) => [row.placeId, row]))
  const seen = new Set<string>()
  const returned: string[] = []
  let created = 0
  let updated = 0

  for (const table of listed) {
    seen.add(table.ref.pos)
    const number = cut(table.name, MAX_NUMBER)
    const hall = table.area
    const row = byPlaceId.get(table.ref.pos)
    if (row === undefined) {
      await tx.insert(tillPlaces).values({
        id: newId('tb'),
        tenantId,
        integrationId: input.integrationId,
        bid: input.bid,
        placeId: table.ref.pos,
        placeNum: number,
        salonName: hall,
        salonId: null,
        salonWeight: null,
        isPublic: true,
      })
      created += 1
      continue
    }
    const same =
      row.placeNum === number && row.salonName === hall && row.state === 'active' && row.isPublic
    if (same) continue
    if (row.state !== 'active' && row.tableId !== null) returned.push(row.tableId)
    if (row.state === 'active') updated += 1
    await tx
      .update(tillPlaces)
      .set({ placeNum: number, salonName: hall, isPublic: true, state: 'active', updatedAt: now })
      .where(eq(tillPlaces.id, row.id))
  }

  // Absence (rule 6 applies to the whole reading, which is complete here): marked, never deleted.
  const activeBefore = stored.filter((row) => row.state === 'active')
  const absent = activeBefore.filter((row) => !seen.has(row.placeId))
  const verdict = absenceHold({
    activeBefore: activeBefore.length,
    seen: seen.size,
    wouldGoMissing: absent.length,
  })
  const vanished: string[] = []
  let held: { reason: string; wouldHide: number } | null = null
  if (verdict.hold) {
    held = { reason: verdict.reason, wouldHide: absent.length }
  } else {
    for (const row of absent) {
      await tx
        .update(tillPlaces)
        .set({ state: 'missing', updatedAt: now })
        .where(eq(tillPlaces.id, row.id))
      if (row.tableId !== null) vanished.push(row.tableId)
    }
  }
  return { created, updated, vanished, returned, held }
}

/**
 * Brings the venue's areas and tables in line with all stored places (a `missing` one keeps its
 * table: the mirror only archives a `deleted` place, which this path never makes) and points each
 * place at its table. `created` is the set of place ids that got a new table in this run.
 */
async function mirrorPlaces(
  tx: WriteTx,
  tenantId: string,
  venueId: string,
  input: ApplyFloorInput,
  now: Date,
) {
  const rows = await tx
    .select()
    .from(tillPlaces)
    .where(and(eq(tillPlaces.integrationId, input.integrationId), eq(tillPlaces.bid, input.bid)))
  const mirrored = await mirrorTillTables(tx, {
    tenantId,
    venueId,
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
    await tx.update(tillPlaces).set({ tableId }).where(eq(tillPlaces.id, placeId))
  }
  const byId = new Map(rows.map((row) => [row.id, row.placeId]))
  const created = new Set(
    [...mirrored.linked.keys()].flatMap((placeId) => {
      const posId = byId.get(placeId)
      return posId === undefined ? [] : [posId]
    }),
  )
  return { created, retiredTokens: mirrored.retiredTokens }
}

/** Upserts the venue's bars; archives the ones the reading no longer lists (never deletes). */
async function writeBars(
  tx: WriteTx,
  tenantId: string,
  venueId: string,
  floor: Floor,
  listed: Floor['tables'],
  source: FloorSource,
  options: { readonly hold: boolean; readonly now: Date },
) {
  const wanted = new Set<string>()
  for (const table of listed) if (table.bar !== null) wanted.add(table.bar.pos)
  for (const key of source.bars ?? []) wanted.add(key)
  const reported = new Map(floor.bars.map((bar) => [bar.ref.pos, bar.name]))

  const stored = await tx.select().from(bars).where(eq(bars.venueId, venueId))
  const byKey = new Map(stored.map((row) => [row.sourceKey, row]))
  const ids = new Map<string, string>()
  let created = 0
  let archived = 0
  let skipped = 0

  for (const key of wanted) {
    const name = reported.get(key)
    if (name === undefined) continue
    if (key.length > MAX_BAR_KEY || cut(name, MAX_BAR_NAME) === '') {
      skipped += 1
      continue
    }
    const row = byKey.get(key)
    if (row === undefined) {
      const id = newId('br')
      await tx
        .insert(bars)
        .values({ id, tenantId, venueId, name: cut(name, MAX_BAR_NAME), sourceKey: key })
      ids.set(key, id)
      created += 1
      continue
    }
    ids.set(key, row.id)
    const changes: Partial<{ name: string; archivedAt: null }> = {}
    if (row.name !== cut(name, MAX_BAR_NAME)) changes.name = cut(name, MAX_BAR_NAME)
    if (row.archivedAt !== null) changes.archivedAt = null
    if (Object.keys(changes).length > 0) {
      await tx.update(bars).set(changes).where(eq(bars.id, row.id))
    }
  }
  if (!options.hold) {
    for (const row of stored) {
      if (row.archivedAt !== null || wanted.has(row.sourceKey)) continue
      await tx.update(bars).set({ archivedAt: options.now }).where(eq(bars.id, row.id))
      archived += 1
    }
  }
  return { ids, created, archived, skipped }
}

/** Sets each listed table's bar and payment mark (see the header). */
async function writeTableFacts(
  tx: WriteTx,
  listed: Floor['tables'],
  tableOf: ReadonlyMap<string, string | null>,
  barIds: ReadonlyMap<string, string>,
  createdNow: ReadonlySet<string>,
  source: FloorSource,
): Promise<void> {
  const tableIds = listed.flatMap((table) => {
    const id = tableOf.get(table.ref.pos)
    return id === undefined || id === null ? [] : [id]
  })
  if (tableIds.length === 0) return
  const rows = await tx.select().from(venueTables).where(inArray(venueTables.id, tableIds))
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const table of listed) {
    const id = tableOf.get(table.ref.pos)
    const row = id === undefined || id === null ? undefined : byId.get(id)
    if (id === undefined || id === null || row === undefined) continue
    const barId = table.bar === null ? null : (barIds.get(table.bar.pos) ?? null)
    // A POS that marks its own is followed; one that does not names none, and the venue's source
    // marks a table once, when it first appears.
    const mark =
      table.paymentTable ??
      (createdNow.has(table.ref.pos) ? source.paymentTables.includes(table.name) : null)
    const changes: Partial<{ barId: string | null; isPaymentTable: boolean; hidden: boolean }> = {}
    if (row.barId !== barId) changes.barId = barId
    if (mark !== null && mark !== row.isPaymentTable) {
      changes.isPaymentTable = mark
      if (mark) changes.hidden = true
    }
    if (Object.keys(changes).length > 0) {
      await tx.update(venueTables).set(changes).where(eq(venueTables.id, id))
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The venue's pick of the floor

/** Why `setFloorSource` refused. */
export type FloorSourceErrorCode = 'invalid_input' | 'venue_not_found' | 'venue_archived'

/** Thrown by `setFloorSource`. */
export class FloorSourceError extends Error {
  override name = 'FloorSourceError'
  readonly code: FloorSourceErrorCode

  constructor(code: FloorSourceErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Saves which part of the instance's floor the venue serves (`venues.settings.floor_source`), or
 * removes the pick with `null` (the whole floor). Other keys of `venues.settings` are left alone.
 * Takes effect at the next floor reading. Idempotent.
 */
export async function setFloorSource(
  pool: DbPool,
  tenantId: string,
  input: { readonly venueId: string; readonly source: FloorSource | null },
): Promise<FloorSource | null> {
  if (!isId('vn', input.venueId))
    throw new FloorSourceError('invalid_input', 'venueId must be a vn_ id')
  const parsed = input.source === null ? null : FloorSourceSchema.safeParse(input.source)
  if (parsed !== null && !parsed.success) {
    throw new FloorSourceError('invalid_input', z.prettifyError(parsed.error))
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, input.venueId, 'update')
    if (locked.refused !== null) {
      throw new FloorSourceError(
        locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
        venueRefusalText(input.venueId, locked.refused),
      )
    }
    const { floor_source: _previous, ...others } = locked.venue.settings
    const next = parsed === null ? null : parsed.data
    await tx
      .update(venues)
      .set({ settings: next === null ? others : { ...others, floor_source: next } })
      .where(eq(venues.id, input.venueId))
    return next
  })
}
