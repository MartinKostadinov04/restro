// A till venue's areas and tables (D95; adjustments T1, B5): the integration layer's mirror that
// keeps the platform's `areas` and `tables` in step with the places a connector read for the
// venue of ours the till venue serves. The connector writes its own rows (`places`, with the
// till's ids); this turns them into the venue's areas (one per hall, keyed by the till's hall id
// and ordered by the till's weight) and tables (one per place, keeping the place's `tb_` id).
// Platform code never reads the places.
//
// Rules:
// - an area and a table are made once; after that the till may change a table's number and
//   move it to another area, and the manager everything else (name, order, hidden). A
//   non-public or placeholder ("--") place starts hidden (D95); the manager may show it;
// - a place the till deleted (concluded after a complete read, rule 6) archives its table and
//   retires its code (the token stays on the archived row, for the purge's tombstone, D83); one
//   listed again brings the table back, without a code;
// - a table of the venue that none of the till venue's places points to (it came from a till
//   venue the venue served before, or was made by hand before the till was linked) is archived
//   and its code retired: on a venue that serves a till, the till's places are the tables (D95);
// - an area from migration 0020 (no till key yet, named after the hall) adopts the hall's key
//   the first time the till reports it.
// The caller passes EVERY stored place of the till venue, whatever its state, and writes
// `places.table_id` from `linked` afterwards (the places are the connector's rows).

import { areas, venueTables } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { newId } from '../ids'
import { sortKeyBetween } from '../sort-keys'

/** One place of the till venue as the connector stored it, with its platform table (if any). */
export interface MirroredPlace {
  /** The place's own `tb_` id, which its table takes. */
  readonly id: string
  readonly placeNum: string | null
  readonly salonId: string | null
  readonly salonWeight: number | null
  readonly salonName: string | null
  readonly isPublic: boolean
  readonly state: 'active' | 'missing' | 'deleted'
  readonly tableId: string | null
}

/** What the mirror did. */
export interface MirrorResult {
  /** Place id → table id, for the places that got a table in this run. */
  readonly linked: ReadonlyMap<string, string>
  /** The tokens of tables archived in this run (their files must go). */
  readonly retiredTokens: readonly string[]
  readonly areasCreated: number
  readonly tablesCreated: number
}

/** The name of the area for places the till puts in no hall. */
export const UNNAMED_AREA = 'Tables'

/** A placeholder place of the till: no real table. */
const PLACEHOLDER_NUMBER = '--'

/** The key an area carries for a hall: the till's hall id, else the hall's name. */
export function areaSourceKey(place: {
  readonly salonId: string | null
  readonly salonName: string | null
}): string {
  if (place.salonId !== null) return `id:${place.salonId}`
  return place.salonName === null ? 'none' : `name:${place.salonName}`
}

/**
 * The order new tables take in an area: numbers as numbers ("2" before "10"), then other labels
 * by code unit, places without a number last, ties by id. Deterministic wherever it runs (no
 * locale), unlike a collator.
 */
export function comparePlaceNumbers(
  a: { readonly placeNum: string | null; readonly id: string },
  b: { readonly placeNum: string | null; readonly id: string },
): number {
  const left = a.placeNum?.trim() || null
  const right = b.placeNum?.trim() || null
  if (left === null || right === null) {
    if (left === right) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    return left === null ? 1 : -1
  }
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  if (leftNumber !== null && rightNumber === null) return -1
  if (leftNumber === null && rightNumber !== null) return 1
  if (left !== right) return left < right ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Keeps the venue's areas and tables in step with the till venue's places (see the header). */
export async function mirrorTillTables(
  tx: WriteTx,
  input: {
    readonly tenantId: string
    readonly venueId: string
    readonly places: readonly MirroredPlace[]
    readonly now: Date
  },
): Promise<MirrorResult> {
  const { tenantId, venueId, now } = input
  const linked = new Map<string, string>()
  const retiredTokens: string[] = []
  let areasCreated = 0
  let tablesCreated = 0

  const existingAreas = await tx
    .select()
    .from(areas)
    .where(and(eq(areas.venueId, venueId), isNull(areas.archivedAt)))
    .orderBy(asc(areas.sortKey), asc(areas.id))
  const areaByKey = new Map<string, (typeof existingAreas)[number]>()
  for (const area of existingAreas) if (area.sourceKey !== null) areaByKey.set(area.sourceKey, area)
  let lastAreaKey = existingAreas.at(-1)?.sortKey ?? null

  // Halls the till reports, in its order (by weight, then by name; places in no hall last): an
  // area each.
  const halls = new Map<string, { name: string; weight: number; unnamed: boolean }>()
  for (const place of input.places) {
    if (place.state === 'deleted') continue
    const key = areaSourceKey(place)
    if (!halls.has(key)) {
      halls.set(key, {
        name: place.salonName?.trim() || UNNAMED_AREA,
        weight: place.salonWeight ?? Number.MAX_SAFE_INTEGER,
        unnamed: key === 'none',
      })
    }
  }
  const ordered = [...halls.entries()].sort(
    ([, a], [, b]) =>
      a.weight - b.weight ||
      Number(a.unnamed) - Number(b.unnamed) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
  for (const [key, hall] of ordered) {
    if (areaByKey.has(key)) continue
    // An area from migration 0020 (no key yet) named after the hall adopts the hall's key.
    const orphan = existingAreas.find(
      (area) => area.sourceKey === null && area.name === hall.name && !areaByKey.has(key),
    )
    if (orphan !== undefined && ![...areaByKey.values()].includes(orphan)) {
      await tx.update(areas).set({ sourceKey: key }).where(eq(areas.id, orphan.id))
      areaByKey.set(key, { ...orphan, sourceKey: key })
      continue
    }
    lastAreaKey = sortKeyBetween(lastAreaKey, null)
    const [row] = await tx
      .insert(areas)
      .values({
        id: newId('ar'),
        tenantId,
        venueId,
        name: hall.name.slice(0, 60).trim() || UNNAMED_AREA,
        sortKey: lastAreaKey,
        sourceKey: key,
      })
      .returning()
    if (row === undefined) throw new Error('the area row was not created')
    areaByKey.set(key, row)
    areasCreated += 1
  }

  const existingTables = await tx.select().from(venueTables).where(eq(venueTables.venueId, venueId))
  const tableById = new Map(existingTables.map((table) => [table.id, table]))
  const lastKeyOfArea = new Map<string, string | null>()
  for (const table of existingTables) {
    const last = lastKeyOfArea.get(table.areaId) ?? null
    if (last === null || table.sortKey > last) lastKeyOfArea.set(table.areaId, table.sortKey)
  }

  // A live table none of the places points to is not the till venue's: archived (see the header).
  const pointedTo = new Set(input.places.map((place) => place.tableId))
  for (const table of existingTables) {
    if (table.archivedAt !== null || pointedTo.has(table.id)) continue
    await tx.update(venueTables).set({ archivedAt: now }).where(eq(venueTables.id, table.id))
    if (table.qrToken !== null) retiredTokens.push(table.qrToken)
  }

  for (const place of [...input.places].sort(comparePlaceNumbers)) {
    const number = place.placeNum?.trim() || null
    // A table of another venue (the place served one before) is not this venue's.
    const table = place.tableId === null ? undefined : tableById.get(place.tableId)
    if (place.state === 'deleted') {
      if (table !== undefined && table.archivedAt === null) {
        await tx.update(venueTables).set({ archivedAt: now }).where(eq(venueTables.id, table.id))
        if (table.qrToken !== null) retiredTokens.push(table.qrToken)
      }
      continue
    }
    const area = areaByKey.get(areaSourceKey(place))
    if (area === undefined) continue
    if (table === undefined) {
      const last = lastKeyOfArea.get(area.id) ?? null
      const sortKey = sortKeyBetween(last, null)
      lastKeyOfArea.set(area.id, sortKey)
      const [row] = await tx
        .insert(venueTables)
        .values({
          id: newId('tb'),
          tenantId,
          venueId,
          areaId: area.id,
          name: null,
          number: number ?? '—',
          sortKey,
          // Non-public and placeholder places start hidden (D95); so does one with no number at
          // all, until the manager names it.
          hidden: !place.isPublic || number === null || number === PLACEHOLDER_NUMBER,
        })
        .returning({ id: venueTables.id })
      if (row === undefined) throw new Error('the table row was not created')
      tablesCreated += 1
      linked.set(place.id, row.id)
      continue
    }
    // The till's number and hall follow the till; the manager's name, order and hidden stay.
    const changes: Partial<{ number: string; areaId: string; archivedAt: null; qrToken: null }> = {}
    const wantedNumber = number ?? (table.name === null ? '—' : table.number)
    if (wantedNumber !== null && wantedNumber !== table.number) changes.number = wantedNumber
    if (table.areaId !== area.id) changes.areaId = area.id
    // Listed again: the table comes back without a code (its old sticker was retired).
    if (table.archivedAt !== null) {
      changes.archivedAt = null
      changes.qrToken = null
    }
    if (Object.keys(changes).length > 0) {
      await tx.update(venueTables).set(changes).where(eq(venueTables.id, table.id))
    }
  }
  return { linked, retiredTokens, areasCreated, tablesCreated }
}
