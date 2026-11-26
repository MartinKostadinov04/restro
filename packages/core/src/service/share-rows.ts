// The shares gathering on Tonight (D160 §3, decision log 2.16; #545): for each group payment still
// collecting its holds, what is held of how much, when the guests' time runs out, and the tables it
// covers. A plain read on a transaction the caller opened; it checks no right (Tonight's read does,
// and `share.cancel` asks for `tables.open_close`). It names nobody who pays (2.4, 2.16): the holds
// come only as sums, and our ids and public fields are all it carries (rule 3).

import { paymentHolds, paymentLines, payments, type ReadTx } from '@restro/db'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'

import { subtractMinor, sumSignedMinor } from '../money'
import { paymentNumberOf } from './payment-number'

/** The payment states while a share gathers its holds. */
export const GATHERING_STATES: readonly string[] = ['requested', 'awaiting_guest']

/** One share still gathering, as Tonight's table sheet and tile need it. */
export interface GatheringShare {
  readonly paymentId: string
  /** The short number the guests show the waiter (`paymentNumberOf`). */
  readonly paymentNumber: string
  /** The table the paying phone is at. */
  readonly tableId: string
  /** Every table the share covers, the paying table among them, in table-id order. */
  readonly tableIds: readonly string[]
  /** The amount shared, tips aside. */
  readonly sharedMinor: number
  /** The parts the guests' cards hold now, tips aside (never who: `payment_holds` stays here). */
  readonly heldMinor: number
  readonly currency: string
  /** When every hold is let go if the share is not covered, from the first hold; null before one. */
  readonly endsAt: Date | null
}

/** The shares of a venue still gathering their holds. */
export async function gatheringShares(
  tx: ReadTx,
  venueId: string,
): Promise<readonly GatheringShare[]> {
  const found = await tx
    .select({
      id: payments.id,
      tableId: payments.tableId,
      sharedMinor: payments.sharedMinor,
      currency: payments.currency,
      endsAt: payments.gatheringEndsAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.venueId, venueId),
        isNotNull(payments.sharedMinor),
        inArray(payments.state, [...GATHERING_STATES]),
      ),
    )
    .orderBy(asc(payments.createdAt), asc(payments.id))
  if (found.length === 0) return []
  const ids = found.map((row) => row.id)
  const holds = await tx
    .select({
      paymentId: paymentHolds.paymentId,
      amountMinor: paymentHolds.amountMinor,
      tipMinor: paymentHolds.tipMinor,
    })
    .from(paymentHolds)
    .where(and(inArray(paymentHolds.paymentId, ids), eq(paymentHolds.state, 'held')))
  const lines = await tx
    .selectDistinct({ paymentId: paymentLines.paymentId, tableId: paymentLines.tableId })
    .from(paymentLines)
    .where(inArray(paymentLines.paymentId, ids))
  return found.flatMap((row) =>
    row.sharedMinor === null
      ? []
      : [
          {
            paymentId: row.id,
            paymentNumber: paymentNumberOf(row.id),
            tableId: row.tableId,
            tableIds: [
              ...new Set([
                row.tableId,
                ...lines.filter((line) => line.paymentId === row.id).map((line) => line.tableId),
              ]),
            ].sort(),
            sharedMinor: row.sharedMinor,
            heldMinor: sumSignedMinor(
              holds
                .filter((hold) => hold.paymentId === row.id)
                .map((hold) => subtractMinor(hold.amountMinor, hold.tipMinor)),
            ),
            currency: row.currency,
            endsAt: row.endsAt,
          },
        ],
  )
}
