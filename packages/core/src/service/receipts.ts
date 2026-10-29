// The reads behind "Bring the receipt" (#200; Tonight screen 1, S7): the paper receipts waiting to
// be brought on Tonight, and the end of the night's list of those never marked Brought. Read-only
// on `withTenant`, our ids and public fields only (rule 3). The payment number the guest shows is
// made from the payment's id (`paymentNumberOf`, #114), so the reads carry `paymentId` and the
// screen words the number.
//
// - Tonight: `alerts.answer`, the right that marks a receipt Brought; the amount is part of the
//   row's words (`r_d`).
// - The end of the night: `night.view`, the first sections' right. It carries no amount (nothing
//   on Telegram shows one), so one list serves the page and the worker's message.

import { type DbPool, payments, type ReadTx, venueTables, withTenant } from '@restro/db'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'

import { dayOf, open, type ReadInput } from './night-read'
import type { TonightRefusal } from './read'

/** The most receipts one read returns: a night of paper receipts is far below it. */
export const MAX_RECEIPTS = 2000

/** One paper receipt waiting to be brought, as Tonight's row needs it. */
export interface ReceiptToBring {
  readonly paymentId: string
  readonly tableId: string
  /** The table's name and number, for the screen to word (a numbered table has no name). */
  readonly name: string | null
  readonly number: string | null
  /** The fiscal receipt's number when the POS gave one at the close; the row shows it then. */
  readonly receiptNumber: string | null
  /** What was charged, tip included: the row's `{amt}`. Always set once a receipt is raised. */
  readonly amountMinor: number
  readonly currency: string
  /** When the payment was captured, so the row is oldest-first. */
  readonly raisedAt: Date
}

/** A receipt of a night that was never marked Brought: no amount, no receipt number. */
export interface ReceiptNotBrought {
  readonly paymentId: string
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
  return { day, rows: rows.slice(0, MAX_RECEIPTS), hasMore: rows.length > MAX_RECEIPTS }
}

/**
 * The receipts to bring on Tonight: this service day's captured payments with a paper receipt not
 * yet marked Brought. Refused for an actor without `alerts.answer`, like the waiter calls.
 */
export async function readReceiptsToBring(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly receipts: readonly ReceiptToBring[] }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { held, today } = opened.reader
    if (!held.has('alerts.answer')) return { ok: false, code: 'permission_denied' } as const
    const rows = await tx
      .select({
        paymentId: payments.id,
        tableId: payments.tableId,
        name: venueTables.name,
        number: venueTables.number,
        receiptNumber: payments.receiptNumber,
        amountMinor: payments.capturedMinor,
        currency: payments.currency,
        raisedAt: payments.receiptToBringAt,
      })
      .from(payments)
      .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
      .where(
        and(
          eq(payments.venueId, input.venueId),
          eq(payments.serviceDate, today),
          isNotNull(payments.receiptToBringAt),
          isNull(payments.receiptBroughtAt),
        ),
      )
      .orderBy(asc(payments.receiptToBringAt), asc(payments.id))
      .limit(MAX_RECEIPTS)
    return {
      ok: true,
      receipts: rows.flatMap((row) =>
        // A receipt is raised at the capture, which sets both.
        row.amountMinor === null || row.raisedAt === null
          ? []
          : [{ ...row, amountMinor: row.amountMinor, raisedAt: row.raisedAt }],
      ),
    } as const
  })
}

/**
 * The end of the night's receipts not brought, for one service day (today when none is asked or the
 * asked day is no date or lies ahead, as the other end-of-night reads).
 * Refused for an actor without `night.view` or `night.view_full`.
 */
export async function readReceiptsNotBrought(
  pool: DbPool,
  input: ReadInput & { readonly day?: string },
): Promise<
  | { readonly ok: true; readonly notBrought: ReceiptsNotBrought }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    const { held, today } = opened.reader
    if (!held.has('night.view') && !held.has('night.view_full')) {
      return { ok: false, code: 'permission_denied' } as const
    }
    return {
      ok: true,
      notBrought: await receiptsNotBrought(tx, input.venueId, dayOf(input.day, today)),
    } as const
  })
}
