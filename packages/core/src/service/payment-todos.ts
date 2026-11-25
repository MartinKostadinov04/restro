// The rows behind the storno and dispute to-dos (#222; decision log 5.3, 5.7, 5.11, 5.17): the
// refunds still waiting for a storno, the disputes still open, and the refunds that did not go
// through after their storno was made. Plain reads on a transaction the caller opened (Tonight's
// read, the end of the night's, the payment's sheet); they check no right. They read the payment
// records by their state, never the alerts (a cleared alert hides no money work, #162). Our ids
// and public fields only (rule 3).

import { logEntries, paymentRefunds, payments, type ReadTx, venueTables } from '@restro/db'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import { paymentNumberOf } from './payment-number'
import { withoutTipMinor } from './staff-amount'

/**
 * A refund's amount for a reader who sees no tips: at most the payment less its tip, so a refund
 * of the whole payment never gives the tip away (#220).
 */
export function refundShownMinor(
  refundMinor: number,
  capturedMinor: number,
  tipMinor: number,
): number {
  const billMinor = withoutTipMinor(capturedMinor, tipMinor) ?? 0
  return Math.min(refundMinor, billMinor)
}

/** The most rows one read returns: a night's refunds are far below it. */
export const MAX_TODOS = 2000

/** One refund still waiting for a storno, as the row needs it (decision log 5.6). */
export interface RefundToDo {
  readonly refundId: string
  readonly paymentId: string
  readonly paymentNumber: string
  readonly tableId: string
  readonly name: string | null
  readonly number: string | null
  /**
   * The refund's amount as the reader may see it: for one who sees no tips, at most the payment
   * less its tip (#220). The true amount is `chargeMinor`.
   */
  readonly amountMinor: number
  /** The refund's true amount: only the manager's PIN sheet shows it (Martin 10-29). */
  readonly chargeMinor: number
  /** What the payment was captured for and its tip, to take the tip off a reader's amount. */
  readonly capturedMinor: number
  readonly tipMinor: number
  readonly currency: string
  /** The payment's service day: the "night of" the storno asks for. */
  readonly serviceDate: string
  /** What the storno at the till asks for: the receipt's number, its time and the fiscal memory. */
  readonly receiptNumber: string | null
  readonly receiptAt: Date | null
  readonly fiscalMemoryNumber: string | null
  readonly seenAt: Date
}

/** A refund that did not go through after its storno was made: check with the accountant. */
export interface RefundFailedAfterStorno {
  readonly refundId: string
  readonly paymentId: string
  readonly tableId: string
  readonly name: string | null
  readonly number: string | null
  /** As the reader may see it, like {@link RefundToDo.amountMinor}. */
  readonly amountMinor: number
  readonly chargeMinor: number
  readonly capturedMinor: number
  readonly tipMinor: number
  readonly currency: string
  readonly failedAt: Date
  readonly serviceDate: string
}

/** One dispute still open. */
export interface DisputeToDo {
  readonly paymentId: string
  readonly paymentNumber: string
  readonly tableId: string
  readonly name: string | null
  readonly number: string | null
  /** The payment's amount (without the tip where the reader sees none). */
  readonly amountMinor: number | null
  readonly tipMinor: number
  readonly currency: string
  /** The payment's service day. */
  readonly serviceDate: string
  readonly openedAt: Date | null
  /** The provider's answer-by date; null where it gave none. */
  readonly dueAt: Date | null
}

/** The time the POS closed a payment's bill: the receipt's time, else the capture's. */
async function receiptTimes(
  tx: ReadTx,
  venueId: string,
  paymentIds: readonly string[],
): Promise<ReadonlyMap<string, Date>> {
  if (paymentIds.length === 0) return new Map()
  const closed = await tx
    .select({ paymentId: logEntries.paymentId, at: logEntries.at })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, venueId),
        eq(logEntries.kind, 'payment.state'),
        eq(logEntries.toState, 'closed'),
        inArray(logEntries.paymentId, [...paymentIds]),
      ),
    )
    .orderBy(asc(logEntries.seq))
  const times = new Map<string, Date>()
  for (const row of closed) if (row.paymentId !== null) times.set(row.paymentId, row.at)
  return times
}

/**
 * The refunds still waiting for a storno, oldest first, whatever their day: a refund of an earlier
 * night stays until a person answers (decision log 5.3).
 */
export async function refundsToDo(tx: ReadTx, venueId: string): Promise<readonly RefundToDo[]> {
  const rows = await tx
    .select({
      refundId: paymentRefunds.id,
      paymentId: paymentRefunds.paymentId,
      tableId: payments.tableId,
      name: venueTables.name,
      number: venueTables.number,
      amountMinor: paymentRefunds.amountMinor,
      capturedMinor: payments.capturedMinor,
      tipMinor: payments.tipMinor,
      currency: payments.currency,
      serviceDate: payments.serviceDate,
      receiptNumber: payments.receiptNumber,
      fiscalMemoryNumber: payments.fiscalMemoryNumber,
      settledAt: payments.settledAt,
      seenAt: paymentRefunds.seenAt,
    })
    .from(paymentRefunds)
    .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(paymentRefunds.venueId, venueId),
        isNull(paymentRefunds.stornoAt),
        isNull(paymentRefunds.failedAt),
      ),
    )
    .orderBy(asc(paymentRefunds.seenAt), asc(paymentRefunds.id))
    .limit(MAX_TODOS)
  const times = await receiptTimes(tx, venueId, [...new Set(rows.map((row) => row.paymentId))])
  return rows.map(({ settledAt, capturedMinor, ...row }) => ({
    ...row,
    chargeMinor: row.amountMinor,
    capturedMinor: capturedMinor ?? 0,
    paymentNumber: paymentNumberOf(row.paymentId),
    receiptAt: times.get(row.paymentId) ?? settledAt,
  }))
}

/**
 * Whether a refund that did not go through was seen ("Got it", #234): its newest such Log entry
 * says `seen` (an Undo writes `open`). The Log entry is the whole record.
 */
export const failedRefundSeen = sql`coalesce((select l.to_state from ${logEntries} l
  where l.venue_id = ${paymentRefunds.venueId} and l.kind = 'payment.refund_failed_seen'
    and l.details ->> 'refundId' = ${paymentRefunds.id}
  order by l.seq desc limit 1), '') = 'seen'`

/**
 * The refunds that did not go through after their storno was made, failed after `failedFrom`: the
 * venue checks with its accountant (decision log 5.7). The caller keeps those of its service day.
 * One a manager has seen ("Got it") is left out; the one that was not leaves after `failedFrom`.
 */
export async function refundsFailedAfterStorno(
  tx: ReadTx,
  venueId: string,
  failedFrom: Date,
): Promise<readonly RefundFailedAfterStorno[]> {
  return tx
    .select({
      refundId: paymentRefunds.id,
      paymentId: paymentRefunds.paymentId,
      tableId: payments.tableId,
      name: venueTables.name,
      number: venueTables.number,
      amountMinor: paymentRefunds.amountMinor,
      capturedMinor: payments.capturedMinor,
      tipMinor: payments.tipMinor,
      currency: payments.currency,
      failedAt: paymentRefunds.failedAt,
      serviceDate: paymentRefunds.serviceDate,
    })
    .from(paymentRefunds)
    .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(
      and(
        eq(paymentRefunds.venueId, venueId),
        isNotNull(paymentRefunds.stornoAt),
        gt(paymentRefunds.failedAt, failedFrom),
        sql`not (${failedRefundSeen})`,
      ),
    )
    .orderBy(asc(paymentRefunds.failedAt), asc(paymentRefunds.id))
    .limit(MAX_TODOS)
    .then((rows) =>
      rows.flatMap((row) =>
        row.failedAt === null
          ? []
          : [
              {
                ...row,
                failedAt: row.failedAt,
                chargeMinor: row.amountMinor,
                capturedMinor: row.capturedMinor ?? 0,
              },
            ],
      ),
    )
}

/** The disputes still open at the venue, the earliest answer-by date first. */
export async function disputesToDo(tx: ReadTx, venueId: string): Promise<readonly DisputeToDo[]> {
  const rows = await tx
    .select({
      paymentId: payments.id,
      tableId: payments.tableId,
      name: venueTables.name,
      number: venueTables.number,
      amountMinor: payments.amountMinor,
      tipMinor: payments.tipMinor,
      currency: payments.currency,
      serviceDate: payments.serviceDate,
      openedAt: payments.disputeOpenedAt,
      dueAt: payments.disputeDueAt,
    })
    .from(payments)
    .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
    .where(and(eq(payments.venueId, venueId), eq(payments.dispute, 'open')))
    .orderBy(asc(payments.disputeDueAt), desc(payments.disputeOpenedAt), asc(payments.id))
    .limit(MAX_TODOS)
  return rows.map((row) => ({ ...row, paymentNumber: paymentNumberOf(row.paymentId) }))
}
