// Stock from the POS (D122 §4 Stock, D124 §6; ticket #80): the writes of a stock pass, through
// apply() (rule 1). What to write is `planStock`'s (`../stock.ts`, pure); this file reads what the
// POS layer holds, keeps what the POS said, and writes the plan as one change set:
//
//   mark   `setField for_sale = false` in the `till` layer at the venue's scope (`venue:<vn>`), the
//          source `till:<integration>` and a source record of its own (`external_type = 'stock'`)
//          that keeps what the POS said, which pass found it and the service day
//   clear  `clearField` of that same row, only where it is still a stock mark (its source record
//          is a `stock` one): the POS's own `for_sale` from a menu reading is never cleared here
//
// The mark sits where the POS's own `for_sale` sits, so the admin reads it as the POS's
// (`saleStateOf`: `offSale: 'till'`) and no control may put it back on sale (rule 5); the live
// overlay greys it for every phone, and a Send refuses it. A menu reading that writes the POS's
// own `for_sale` over it is the POS's later word, which wins either way.
//
// The tenant's document lock comes first, then the venue (shared), as every apply() writer does.

import { type DbPool, fieldValues, sourceLinks, sourceRecords, withTenant } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, inArray } from 'drizzle-orm'

import type { Actor, ChangeSet, ChangeSetOp } from '../change-set'
import { canonicalJson, sha256Hex } from '../hash'
import { idSchema, type NodeId, newId } from '../ids'
import { serviceDate } from '../service-day'
import {
  lapsedStockMarks,
  planStock,
  type StockPlan,
  type StockReading,
  type StockSlot,
} from '../stock'
import { applyInTransaction } from './apply'
import { lockTenantDocument } from './lock'
import { resolveRoutes } from './menu-routes'
import { lockLiveVenue } from './venue-lock'

/** The external type of a stock pass's source record. */
export const STOCK_RECORD_TYPE = 'stock'

/** The version of what a stock pass writes (a till write records its mapping version). */
export const STOCK_MAPPING_VERSION = 1

/** Which pass found it: the check before a Send, the POS's refusal, or the day's end. */
export type StockPass = 'availability' | 'refusal' | 'lapse'

/** One stock pass to record for a venue. */
export interface RecordStockInput {
  readonly integrationId: string
  readonly venueId: string
  readonly pass: Exclude<StockPass, 'lapse'>
  /** Our item ids, as the worker mapped them from the POS's answer. */
  readonly reading: StockReading
  /** The job the change set belongs to; a fresh one when left out. */
  readonly jobId?: string
}

/** What a stock pass changed. */
export interface StockResult {
  /** Items newly marked sold out by the POS. */
  readonly marked: readonly NodeId[]
  /** Items whose mark was cleared. */
  readonly cleared: readonly NodeId[]
}

const NOTHING: StockResult = { marked: [], cleared: [] }

/** One stock mark in the POS layer, as the tick finds it. */
export interface StockMark {
  readonly integrationId: string
  readonly venueId: string
  readonly itemId: NodeId
  /** The service day the mark was written for, or null when its record can't say. */
  readonly serviceDate: string | null
}

/** The stored slot of one item, with the day of a stock mark. */
interface StoredSlot extends StockSlot {
  readonly serviceDate: string | null
}

const venueScope = (venueId: string) => `venue:${venueId}` as const

/** The `serviceDate` of a stock record's payload, or null. */
function dayOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const day = (payload as { readonly serviceDate?: unknown }).serviceDate
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/**
 * The POS layer's `for_sale` at the venue's scope for each item linked (active) to the
 * integration; an item with no link is missing from the map.
 */
async function readSlots(
  tx: WriteTx,
  integrationId: string,
  venueId: string,
  itemIds: readonly string[],
): Promise<{ readonly slots: Map<string, StoredSlot>; readonly external: Map<string, string> }> {
  const slots = new Map<string, StoredSlot>()
  const external = new Map<string, string>()
  if (itemIds.length === 0) return { slots, external }
  const links = await tx
    .select({ nodeId: sourceLinks.nodeId, externalId: sourceLinks.externalId })
    .from(sourceLinks)
    .where(
      and(
        eq(sourceLinks.integrationId, integrationId),
        inArray(sourceLinks.nodeId, [...itemIds]),
        eq(sourceLinks.state, 'active'),
      ),
    )
  for (const link of links) {
    external.set(link.nodeId, link.externalId)
    slots.set(link.nodeId, { value: null, ours: false, serviceDate: null })
  }
  const rows = await tx
    .select({
      nodeId: fieldValues.nodeId,
      value: fieldValues.value,
      valid: fieldValues.valid,
      recordType: sourceRecords.externalType,
      recordPayload: sourceRecords.payload,
    })
    .from(fieldValues)
    .leftJoin(sourceRecords, eq(sourceRecords.id, fieldValues.sourceRecordId))
    .where(
      and(
        inArray(fieldValues.nodeId, [...external.keys()]),
        eq(fieldValues.fieldKey, 'for_sale'),
        eq(fieldValues.layer, 'till'),
        eq(fieldValues.scope, venueScope(venueId)),
      ),
    )
  for (const row of rows) {
    const ours = row.recordType === STOCK_RECORD_TYPE
    slots.set(row.nodeId, {
      value: row.valid && typeof row.value === 'boolean' ? row.value : null,
      ours,
      serviceDate: ours ? dayOf(row.recordPayload) : null,
    })
  }
  return { slots, external }
}

/**
 * Writes a plan for one venue in the caller's transaction: a source record per mark, then one
 * change set. `decide` gets the slots and the venue's service day; nothing is written for a
 * deleted venue or an empty plan.
 */
async function writeStock(
  tx: WriteTx,
  tenantId: string,
  target: {
    readonly integrationId: string
    readonly venueId: string
    readonly itemIds: readonly string[]
    readonly pass: StockPass
    readonly jobId: string
    readonly now: Date
  },
  decide: (slots: ReadonlyMap<string, StoredSlot>, day: string) => StockPlan,
): Promise<StockResult> {
  const { integrationId, venueId, now } = target
  await lockTenantDocument(tx, tenantId)
  const locked = await lockLiveVenue(tx, venueId)
  if (locked.refused !== null) return NOTHING
  const day = serviceDate(now, locked.venue.timezone, locked.venue.serviceDayEndsAt)
  const { slots, external } = await readSlots(tx, integrationId, venueId, target.itemIds)
  const plan = decide(slots, day)
  if (plan.mark.length + plan.clear.length === 0) return NOTHING

  const scope = venueScope(venueId)
  const ops: ChangeSetOp[] = []
  for (const itemId of plan.mark) {
    // What the POS said, kept as the mark's source record (tier 1): its own words stay here.
    const said = {
      item: external.get(itemId) ?? null,
      available: false,
      pass: target.pass,
      serviceDate: day,
    }
    const raw = canonicalJson(said)
    const recordId = newId('sr')
    await tx.insert(sourceRecords).values({
      id: recordId,
      tenantId,
      integrationId,
      externalType: STOCK_RECORD_TYPE,
      externalId: said.item ?? itemId,
      scope,
      contentHash: sha256Hex(raw),
      raw,
      payload: said,
    })
    ops.push({
      op: 'setField',
      node: { id: itemId as NodeId },
      fieldKey: 'for_sale',
      layer: 'till',
      scope,
      value: false,
      sourceRecordId: recordId,
      mappingVersion: STOCK_MAPPING_VERSION,
    })
  }
  for (const itemId of plan.clear) {
    ops.push({
      op: 'clearField',
      node: { id: itemId as NodeId },
      fieldKey: 'for_sale',
      layer: 'till',
      scope,
    })
  }
  const changeSet: ChangeSet = {
    id: newId('cs'),
    source: `till:${integrationId}`,
    jobId: target.jobId,
    actor: `integration:${integrationId}` as Actor,
    observedAt: now.toISOString(),
    ops,
  }
  const result = await applyInTransaction(tx, tenantId, changeSet)
  const refused = new Set(result.rejected.map((rejection) => rejection.opIndex))
  return {
    marked: plan.mark.filter((_, index) => !refused.has(index)) as NodeId[],
    cleared: plan.clear.filter((_, index) => !refused.has(plan.mark.length + index)) as NodeId[],
  }
}

/**
 * Records one stock pass for a venue: marks what the POS said ran out, clears our marks of what a
 * complete reading said is back (`planStock`). An incomplete reading writes nothing (rule 6).
 * `options.now` decides the service day (default: now); tests inject it.
 */
export async function recordPosStock(
  pool: DbPool,
  tenantId: string,
  input: RecordStockInput,
  options: { readonly now?: Date } = {},
): Promise<StockResult> {
  idSchema('in').parse(input.integrationId)
  idSchema('vn').parse(input.venueId)
  const { reading } = input
  if (!reading.complete || reading.items.length === 0) return NOTHING
  const itemIds = [...new Set(reading.items.map((item) => idSchema('nd').parse(item.itemId)))]
  return withTenantWrite(pool, tenantId, (tx) =>
    writeStock(
      tx,
      tenantId,
      {
        integrationId: input.integrationId,
        venueId: input.venueId,
        itemIds,
        pass: input.pass,
        jobId: input.jobId ?? newId('jb'),
        now: options.now ?? new Date(),
      },
      (slots) => planStock(slots, reading),
    ),
  )
}

/** Every stock mark of the tenant that still stands, oldest venue first. */
export async function listStockMarks(pool: DbPool, tenantId: string): Promise<StockMark[]> {
  const rows = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({
        source: fieldValues.source,
        scope: fieldValues.scope,
        nodeId: fieldValues.nodeId,
        value: fieldValues.value,
        payload: sourceRecords.payload,
      })
      .from(fieldValues)
      .innerJoin(sourceRecords, eq(sourceRecords.id, fieldValues.sourceRecordId))
      .where(
        and(
          eq(fieldValues.fieldKey, 'for_sale'),
          eq(fieldValues.layer, 'till'),
          eq(sourceRecords.externalType, STOCK_RECORD_TYPE),
        ),
      ),
  )
  const marks: StockMark[] = []
  for (const row of rows) {
    if (row.value !== false || !row.scope.startsWith('venue:') || !row.source.startsWith('till:')) {
      continue
    }
    marks.push({
      integrationId: row.source.slice('till:'.length),
      venueId: row.scope.slice('venue:'.length),
      itemId: row.nodeId as NodeId,
      serviceDate: dayOf(row.payload),
    })
  }
  return marks.sort((a, b) =>
    a.venueId === b.venueId ? (a.itemId < b.itemId ? -1 : 1) : a.venueId < b.venueId ? -1 : 1,
  )
}

/**
 * Clears the stock marks of one venue and integration that belong to an earlier service day
 * (`lapsedStockMarks`): what it cleared.
 */
export async function lapseStockMarks(
  pool: DbPool,
  tenantId: string,
  target: {
    readonly integrationId: string
    readonly venueId: string
    readonly itemIds: readonly string[]
  },
  options: { readonly now?: Date } = {},
): Promise<StockResult> {
  if (target.itemIds.length === 0) return NOTHING
  return withTenantWrite(pool, tenantId, (tx) =>
    writeStock(
      tx,
      tenantId,
      { ...target, pass: 'lapse', jobId: newId('jb'), now: options.now ?? new Date() },
      (slots, day) => {
        const marks = [...slots]
          .filter(([, slot]) => slot.ours && slot.value === false)
          .map(([itemId, slot]) => ({ itemId, serviceDate: slot.serviceDate }))
        return { mark: [], clear: lapsedStockMarks(marks, day) }
      },
    ),
  )
}

/**
 * The menus a venue's phones show (its live menu and every table route's): the scopes whose
 * `live.json` a stock change has to remake.
 */
export async function liveScopesOfVenue(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<{ readonly menuId: NodeId; readonly venueId: string }[]> {
  const routes = await resolveRoutes(pool, tenantId, venueId)
  const menus = new Set<string>()
  for (const menuId of [routes.live, ...routes.tables.values()]) {
    if (menuId !== null) menus.add(menuId)
  }
  return [...menus].sort().map((menuId) => ({ menuId: menuId as NodeId, venueId }))
}
