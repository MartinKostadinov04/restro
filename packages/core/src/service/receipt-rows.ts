// The rows behind "Bring the receipt" (#200): the paper receipts of a service day still to be
// brought, and those of a past night never marked Brought. Plain reads on a transaction the caller
// opened (Tonight's read, the end of the night's, the receipts' own reads in `receipts.ts`); they
// check no right. Our ids and public fields only (rule 3).

import { payments, type ReadTx, venueTables } from '@restro/db'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'

import { paymentNumberOf } from './payment-number'
import { withoutTipMinor } from './staff-amount'

/** The most receipts one read returns: a night of paper receipts is far below it. */
export const MAX_RECEIPTS = 2000

/** One paper receipt waiting to be brought, as Tonight's row needs it. */
export interface ReceiptToBring {
  readonly paymentId: string
  /** The number the guest shows the waiter (`paymentNumberOf`). */
  readonly paymentNumber: string
  readonly tableId: string
  /** The table's name and number, for the screen to word (a numbered table has no name). */
  readonly name: string | null
  readonly number: string | null
  /** The fiscal receipt's number when the POS gave one at the close; the row shows it then. */
  readonly receiptNumber: string | null
  /**
   * What was charged: the row's `{amt}`. Always set once a receipt is raised. With the tip for a
   * reader of the whole night, without it for staff (#220).
   */
  readonly amountMinor: number
  readonly currency: string
  /** When the payment was captured, so the row is oldest-first. */
  readonly raisedAt: Date
}

/** A receipt of a night that was never marked Brought: no amount, no receipt number. */
export interface ReceiptNotBrought {
  readonly paymentId: string
  readonly paymentNumber: string
  readonly tableId: string
  readonly name: string | null
  readonly number: string | null
}

/** Receipts not brought, of one service day. */
export interface ReceiptsNotBrought {
  readonly day: string
  readonly rows: readonly ReceiptNotBrought[]
  /** True when more than `MAX_RECEIPTS` waited and the rows are the oldest. */
  readonly hasMore: boolean
}

/** The receipts of `day` not marked Brought, oldest first. Shared by the page and the worker. */
export async function receiptsNotBrought(
  tx: ReadTx,
  venueId: string,
  day: string,
): Promise<ReceiptsNotBrought> {
  const rows = await tx
    .select({
      paymentId: payments.id,
      tableId: payments.tableId,
      name: venueTables.name,
      number: venueTables.number,
    })
    .from(payments)
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(payments.venueId, venueId),
        eq(payments.serviceDate, day),
        isNotNull(payments.receiptToBringAt),
        isNull(payments.receiptBroughtAt),
      ),
    )
    .orderBy(asc(payments.receiptToBringAt), asc(payments.id))
    .limit(MAX_RECEIPTS + 1)
  return {
    day,
    rows: rows
      .slice(0, MAX_RECEIPTS)
      .map((row) => ({ ...row, paymentNumber: paymentNumberOf(row.paymentId) })),
    hasMore: rows.length > MAX_RECEIPTS,
  }
}

/**
 * The receipts to bring of `day`, oldest first. Shared by Tonight's read and the receipts' own.
 * `full` is true for a reader with `night.view_full`; any other gets the amount without the tip.
 */
export async function receiptsToBring(
  tx: ReadTx,
  venueId: string,
  day: string,
  full: boolean,
): Promise<readonly ReceiptToBring[]> {
  const rows = await tx
    .select({
      paymentId: payments.id,
      tableId: payments.tableId,
      name: venueTables.name,
      number: venueTables.number,
      receiptNumber: payments.receiptNumber,
      amountMinor: payments.capturedMinor,
      tipMinor: payments.tipMinor,
      currency: payments.currency,
      raisedAt: payments.receiptToBringAt,
    })
    .from(payments)
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(payments.venueId, venueId),
        eq(payments.serviceDate, day),
        isNotNull(payments.receiptToBringAt),
        isNull(payments.receiptBroughtAt),
      ),
    )
    .orderBy(asc(payments.receiptToBringAt), asc(payments.id))
    .limit(MAX_RECEIPTS)
  return rows.flatMap(({ tipMinor, ...row }) =>
    // A receipt is raised at the capture, which sets both.
    row.amountMinor === null || row.raisedAt === null
      ? []
      : [
          {
            ...row,
            paymentNumber: paymentNumberOf(row.paymentId),
            amountMinor: (full ? row.amountMinor : withoutTipMinor(row.amountMinor, tipMinor)) ?? 0,
            raisedAt: row.raisedAt,
          },
        ],
  )
}
