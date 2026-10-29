// An item's payment mode for a whole selection (#218; D113, D122 §5): the selection bar's "Payment
// mode…". The mode is the item field `payment_mode`, Restro's own on every venue (owner `builder`),
// so it goes in the manual layer, master scope. ONE atomic change set through apply() (rule 1), as
// `setItemTags` does for tags: either every ticked item gets the mode or none does. `null` = "same
// as the venue": it clears our value. An item that already holds it is left out (nothing is
// written for it). It takes effect at the menu's next Publish, as every composer change does.

import { type DbPool, nodes } from '@restro/db'
import { type WriteTx, withTenantWrite } from '@restro/db/write'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { ActorSchema, type ChangeSet, type ChangeSetOp } from '../change-set'
import { idSchema, newId } from '../ids'
import { PAYMENT_MODES } from '../templates/venue-menu'
import { type ApplyResult, applyInTransaction } from './apply'
import { lockTenantDocument } from './lock'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The most items one call changes (as the tags' bulk limit). */
export const MAX_PAYMENT_MODE_ITEMS = 1000

const SetItemPaymentModeSchema = z.strictObject({
  venueId: idSchema('vn'),
  itemIds: z.array(idSchema('nd')).min(1).max(MAX_PAYMENT_MODE_ITEMS),
  /** The mode to set; `null` takes our value away, so the items follow the venue's default. */
  mode: z.enum(PAYMENT_MODES).nullable(),
  actor: ActorSchema,
})

/** What `setItemPaymentMode` takes. */
export type SetItemPaymentModeInput = z.input<typeof SetItemPaymentModeSchema>

/** Why `setItemPaymentMode` refused before it reached apply(). */
export type PaymentModeErrorCode =
  /** The input is not shaped right. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'unknown_venue'
  /** The venue was deleted (D76). */
  | 'venue_archived'
  /** One of the ids is not an active item of this tenant. */
  | 'unknown_item'

/** Thrown when the change is refused. Nothing is written. */
export class PaymentModeError extends Error {
  override name = 'PaymentModeError'
  readonly code: PaymentModeErrorCode

  constructor(message: string, code: PaymentModeErrorCode = 'invalid_input') {
    super(message)
    this.code = code
  }
}

/**
 * Sets (or, with `mode: null`, clears) the payment mode of a whole selection of items, as ONE
 * atomic change set. An id that is not an active item of the venue refuses the whole call
 * (`PaymentModeError`, `unknown_item`); anything apply() refuses throws an `ApplyError`.
 */
export async function setItemPaymentMode(
  pool: DbPool,
  tenantId: string,
  input: SetItemPaymentModeInput,
  options: { readonly now?: Date } = {},
): Promise<ApplyResult> {
  const parsed = SetItemPaymentModeSchema.safeParse(input)
  if (!parsed.success) {
    throw new PaymentModeError(parsed.error.issues[0]?.message ?? 'invalid input')
  }
  const { venueId, itemIds, mode, actor } = parsed.data
  const unique = [...new Set(itemIds)]
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const locked = await lockLiveVenue(tx, venueId)
    if (locked.refused !== null) {
      throw new PaymentModeError(
        venueRefusalText(venueId, locked.refused),
        locked.refused === 'venue_archived' ? 'venue_archived' : 'unknown_venue',
      )
    }
    await assertActiveItems(tx, unique)
    const ops: ChangeSetOp[] = unique.map((id) =>
      mode === null
        ? {
            op: 'clearField',
            node: { id },
            fieldKey: 'payment_mode',
            layer: 'manual',
            scope: 'master',
          }
        : {
            op: 'setField',
            node: { id },
            fieldKey: 'payment_mode',
            layer: 'manual',
            scope: 'master',
            value: mode,
          },
    )
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor,
      observedAt: (options.now ?? new Date()).toISOString(),
      ops,
    }
    return applyInTransaction(tx, tenantId, changeSet, { atomic: true })
  })
}

async function assertActiveItems(tx: WriteTx, ids: readonly string[]) {
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
    throw new PaymentModeError('every id must be an active item of this tenant', 'unknown_item')
  }
}
