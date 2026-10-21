// Sold out tonight (brief S3-08, D46, rule 5). A manager marks items "sold out tonight" during
// service, and takes the mark off again; both are ONE atomic change set through apply() (rule 1).
//
//   mark    `setField for_sale = false` in the layer `edition:service:<service date>`, master scope,
//           source `manual`, the person as actor
//   unmark  `clearField` of that same layer and field
//
// The service date is the venue's current one (`serviceDate`: the day ends at 07:00 by default,
// D45), so a mark is a row of ITS evening: when the day changes the layer is no longer in the
// resolver's `edition` list and the mark lapses by itself, in every resolution, with no job and no
// publish. Snapshots are resolved without the service edition (publish.ts), so only `live.json`
// carries marks.
//
// Rule 5 is the point of this file. There is no way to ask for `true` here: unmarking is a clear,
// never a write, and `validateWrite` refuses a `true` on an edition layer anyway (`less_cautious`).
// Clearing our mark can only reveal the layers below, so an item barsy has off sale (the barsy
// layer says `false`, and `all_true` lets any `false` win) stays off sale whatever is sent here.

import { type DbPool, nodes } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { ActorSchema, type ChangeSet, type ChangeSetOp } from '../change-set'
import { idSchema, newId } from '../ids'
import { serviceDate, serviceEditionLayer } from '../service-day'
import { type ApplyResult, applyInTransaction } from './apply'
import { lockTenantDocument } from './lock'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The most items one call marks or unmarks. */
export const MAX_SOLD_OUT_ITEMS = 200

const SetSoldOutSchema = z.strictObject({
  venueId: idSchema('vn'),
  itemIds: z.array(idSchema('nd')).min(1).max(MAX_SOLD_OUT_ITEMS),
  /** True marks the items sold out tonight; false removes the mark. There is no "on sale" write. */
  soldOut: z.boolean(),
  actor: ActorSchema,
})

/** What `setSoldOutTonight` takes. */
export type SetSoldOutInput = z.input<typeof SetSoldOutSchema>

/** Why `setSoldOutTonight` refused before it reached apply(). */
export type SoldOutErrorCode =
  /** The input is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The venue was deleted (D76). */
  | 'venue_archived'
  /** One of the ids is not an active item of this tenant. */
  | 'unknown_item'

/** Thrown when a mark or unmark is refused. Nothing is written. */
export class SoldOutError extends Error {
  override name = 'SoldOutError'
  readonly code: SoldOutErrorCode

  constructor(code: SoldOutErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** What `setSoldOutTonight` did. */
export interface SoldOutResult extends ApplyResult {
  /** The service date the marks belong to (`YYYY-MM-DD`). */
  readonly day: string
}

/**
 * Marks items sold out tonight (`soldOut: true`) or takes the mark off (`false`), for the
 * venue's current service day, as one atomic change set. Marking an item that is marked already,
 * or unmarking one that is not, changes nothing. An id that is not an active item of the tenant
 * refuses the whole call (`SoldOutError`, `unknown_item`); anything apply() refuses throws an
 * `ApplyError`. The caller queues the `publish-live` job for the venue's menu afterwards.
 *
 * `options.now` is the instant that decides the service day (default: now); tests inject it.
 */
export async function setSoldOutTonight(
  pool: DbPool,
  tenantId: string,
  input: SetSoldOutInput,
  options: { readonly now?: Date } = {},
): Promise<SoldOutResult> {
  const parsed = SetSoldOutSchema.safeParse(input)
  if (!parsed.success) {
    throw new SoldOutError('invalid_input', parsed.error.issues[0]?.message ?? 'invalid input')
  }
  const { venueId, itemIds, soldOut, actor } = parsed.data
  const now = options.now ?? new Date()
  const unique = [...new Set(itemIds)]
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const day = await currentServiceDay(tx, venueId, now)
    await assertActiveItems(tx, unique)
    const layer = serviceEditionLayer(day)
    const ops: ChangeSetOp[] = unique.map((id) =>
      soldOut
        ? {
            op: 'setField',
            node: { id },
            fieldKey: 'for_sale',
            layer,
            scope: 'master',
            value: false,
          }
        : { op: 'clearField', node: { id }, fieldKey: 'for_sale', layer, scope: 'master' },
    )
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: now.toISOString(),
      ops,
    }
    const result = await applyInTransaction(tx, tenantId, changeSet, { atomic: true })
    return { ...result, day }
  })
}

/** The venue's service date at `now`, from its time zone and the end of its day. */
async function currentServiceDay(tx: WriteTx, venueId: string, now: Date): Promise<string> {
  const locked = await lockLiveVenue(tx, venueId)
  if (locked.refused !== null) {
    throw new SoldOutError(
      locked.refused === 'venue_archived' ? 'venue_archived' : 'unknown_venue',
      venueRefusalText(venueId, locked.refused),
    )
  }
  const { venue } = locked
  return serviceDate(now, venue.timezone, venue.serviceDayEndsAt)
}

async function assertActiveItems(tx: WriteTx, ids: readonly string[]): Promise<void> {
  const rows = await tx
    .select({ id: nodes.id })
    .from(nodes)
    .where(
      and(
        inArray(nodes.id, [...ids]),
        eq(nodes.nodeType, 'item'),
        inArray(nodes.status, ['active', 'hidden']),
      ),
    )
  if (rows.length !== ids.length) {
    throw new SoldOutError('unknown_item', 'every id must be an active item of this tenant')
  }
}
