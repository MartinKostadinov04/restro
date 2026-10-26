// What Tonight is told about stock (#80, D122 §4 Stock): when a stock pass marks items run out in
// the POS, the worker records the notice "Out of stock in {source}: Mojito. Greyed out on the
// menu." as an alert, one open alert per item; when a later complete reading clears the mark (or
// the service day ends), the item's alert is done. The mark itself is apply()'s
// (`apply/stock.ts`): this writes only the alert and its Log entries.

import { alerts } from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema, newId } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'

/** The alert's kind: an item the POS says ran out. */
export const OUT_OF_STOCK_ALERT = 'item_out_of_stock'

/** At most this many items in one notice (a Send has at most this many lines anyway). */
const MAX_NOTICE_ITEMS = 100

const NoticeSchema = z.strictObject({
  type: z.literal('notice.record'),
  notice: z.literal(OUT_OF_STOCK_ALERT),
  /** The POS instance that said it (the notice names its system as `{source}`). */
  integrationId: idSchema('in'),
  /** Items newly marked run out, with the POS's name for staff (never shown to a guest). */
  out: z
    .array(z.strictObject({ itemId: idSchema('nd'), name: z.string().min(1).max(200) }))
    .max(MAX_NOTICE_ITEMS),
  /** Items whose mark was cleared: their alerts are done. */
  back: z.array(idSchema('nd')).max(MAX_NOTICE_ITEMS),
})

/** The `notice.record` command, as its schema parses it. */
export type StockNotice = z.output<typeof NoticeSchema>

/** Raises one open alert per run-out item and closes the alerts of items that are back. */
async function recordStockNotice(stx: ServiceTx, command: StockNotice): Promise<ServiceResult> {
  const out = [...new Map(command.out.map((item) => [item.itemId, item])).values()]
  const back = [...new Set(command.back)].filter((id) => !out.some((item) => item.itemId === id))
  const subjects = [...out.map((item) => item.itemId), ...back].sort()
  if (subjects.length === 0) return accepted(null, { details: { raised: 0, done: 0 } })

  stx.rows.claim(
    'alert',
    subjects.map((itemId) => `${OUT_OF_STOCK_ALERT}:${itemId}`),
  )
  const open = await stx.tx
    .select({ id: alerts.id, subjectId: alerts.subjectId })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, OUT_OF_STOCK_ALERT),
        inArray(alerts.subjectId, subjects),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  const openBySubject = new Map(open.map((row) => [row.subjectId, row.id]))

  let raised = 0
  for (const item of out) {
    if (openBySubject.has(item.itemId)) continue
    const id = newId('al')
    await stx.tx.insert(alerts).values({
      id,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: stx.serviceDate,
      kind: OUT_OF_STOCK_ALERT,
      audience: 'venue',
      subjectId: item.itemId,
      permission: 'alerts.answer',
      details: { itemId: item.itemId, name: item.name, integrationId: command.integrationId },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    await stx.log({
      kind: 'alert.raised',
      reason: OUT_OF_STOCK_ALERT,
      details: { alertId: id, itemId: item.itemId },
    })
    raised += 1
  }

  let done = 0
  for (const itemId of back) {
    const id = openBySubject.get(itemId)
    if (id === undefined) continue
    await stx.tx
      .update(alerts)
      .set({
        doneAt: sql`now()`,
        doneBy: stx.provenance.actor,
        via: stx.via,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, id))
    await stx.log({
      kind: 'alert.done',
      reason: OUT_OF_STOCK_ALERT,
      details: { alertId: id, itemId },
    })
    done += 1
  }
  return accepted(null, { details: { raised, done } })
}

/** `notice.record` (#80): the worker's stock notice for Tonight. */
export function stockNotice() {
  return defineCommand({
    schema: NoticeSchema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: recordStockNotice,
  })
}
