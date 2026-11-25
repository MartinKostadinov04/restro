// A table that edits its order faster than 60 times a minute (D121, design §7; #75): the engine
// refuses the edit `rate_limited`, and this writes what the trip leaves behind, under the table's
// order lock so two trips at once can't both write it:
// - a `guard.tripped` Log entry (reason `order_rate`), at most one a minute per table;
// - an alert to Restro's admin team (audience `restro`, kind `order_rate`, the table as its
//   subject), one open alert per table until it is answered (#83 delivers it).
// Nothing about the phone is kept: the count is the table's.

import { alerts, logEntries } from '@restro/db'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import { newId } from '../ids'
import { ORDER_CHANGES_PER_MINUTE } from '../table-order'
import type { ServiceTx } from './definition'

/** The alert's kind. */
export const ORDER_RATE_ALERT = 'order_rate'

/** Writes the Log entry and the alert of a rate trip on `tableId`. */
export async function tripOrderRate(
  stx: ServiceTx,
  tableId: string,
  sittingId: string,
): Promise<void> {
  const { tx } = stx
  const minuteAgo = new Date((await stx.dbNow()).getTime() - 60_000)
  const [logged] = await tx
    .select({ seq: logEntries.seq })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        eq(logEntries.tableId, tableId),
        eq(logEntries.kind, 'guard.tripped'),
        eq(logEntries.reason, ORDER_RATE_ALERT),
        gt(logEntries.at, minuteAgo),
      ),
    )
    .limit(1)
  if (logged === undefined) {
    await stx.log({
      kind: 'guard.tripped',
      tableId,
      sittingId,
      reason: ORDER_RATE_ALERT,
      details: { perMinute: ORDER_CHANGES_PER_MINUTE },
    })
  }

  stx.rows.claim('alert', [`${ORDER_RATE_ALERT}:${tableId}`])
  const [open] = await tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, ORDER_RATE_ALERT),
        eq(alerts.subjectId, tableId),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  if (open !== undefined) return
  const id = newId('al')
  await tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: ORDER_RATE_ALERT,
    audience: 'restro',
    subjectId: tableId,
    permission: null,
    details: { perMinute: ORDER_CHANGES_PER_MINUTE },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    tableId,
    sittingId,
    reason: ORDER_RATE_ALERT,
    details: { alertId: id },
  })
}
