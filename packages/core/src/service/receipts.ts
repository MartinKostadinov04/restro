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

import { type DbPool, payments, type ReadTx, venues, venueTables, withTenant } from '@restro/db'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'

import { serviceDate } from '../service-day'
import type { ServiceActor } from './context'
import { resolveGrants } from './grants'
import type { Permission } from './permissions'
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
  /** The fiscal receipt's number, read from the POS at the close (the waiter matches it). */
  readonly receiptNumber: string
  /** What the guest paid, tip included: the row's `{amt}`. */
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

interface Input {
  readonly tenantId: string
  readonly venueId: string
  readonly actor: ServiceActor
  readonly now?: Date
}

type Opened =
  | { readonly ok: true; readonly today: string; readonly held: ReadonlySet<Permission> }
  | { readonly ok: false; readonly code: TonightRefusal }

/** The actor's grants at the venue, as Tonight's reads check them (a shared device reads quickly). */
async function open(tx: ReadTx, input: Input): Promise<Opened> {
  const { actor } = input
  if (actor.kind !== 'user' && actor.kind !== 'staff' && actor.kind !== 'operator') {
    return { ok: false, code: 'origin_not_allowed' }
  }
  const [venue] = await tx.select().from(venues).where(eq(venues.id, input.venueId))
  if (venue === undefined) return { ok: false, code: 'venue_missing' }
  if (venue.archivedAt !== null) return { ok: false, code: 'venue_archived' }
  const grants = await resolveGrants(tx, input.tenantId, venue.id, actor, { quick: true })
  if (!grants.ok) return { ok: false, code: grants.code }
  return {
    ok: true,
    held: grants.permissions,
    today: serviceDate(input.now ?? new Date(), venue.timezone, venue.serviceDayEndsAt),
  }
}

/**
 * The receipts to bring on Tonight: this service day's captured payments with a paper receipt not
 * yet marked Brought. Refused for an actor without `alerts.answer`, like the waiter calls.
 */
export async function readReceiptsToBring(
  pool: DbPool,
  input: Input,
): Promise<
  | { readonly ok: true; readonly receipts: readonly ReceiptToBring[] }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    if (!opened.held.has('alerts.answer')) return { ok: false, code: 'permission_denied' } as const
    const rows = await tx
      .select({
        paymentId: payments.id,
        tableId: payments.tableId,
        name: venueTables.name,
        number: venueTables.number,
        receiptNumber: payments.receiptNumber,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        raisedAt: payments.receiptToBringAt,
      })
      .from(payments)
      .innerJoin(venueTables, eq(venueTables.id, payments.tableId))
      .where(
        and(
          eq(payments.venueId, input.venueId),
          eq(payments.serviceDate, opened.today),
          isNotNull(payments.receiptToBringAt),
          isNull(payments.receiptBroughtAt),
        ),
      )
      .orderBy(asc(payments.receiptToBringAt), asc(payments.id))
      .limit(MAX_RECEIPTS)
    return {
      ok: true,
      receipts: rows.flatMap((row) =>
        // The table's checks keep these set once a receipt is to be brought.
        row.receiptNumber === null || row.amountMinor === null || row.raisedAt === null
          ? []
          : [
              {
                ...row,
                receiptNumber: row.receiptNumber,
                amountMinor: row.amountMinor,
                raisedAt: row.raisedAt,
              },
            ],
      ),
    } as const
  })
}

/**
 * The end of the night's receipts not brought, for one service day (today when none is asked).
 * Refused for an actor without `night.view` or `night.view_full`.
 */
export async function readReceiptsNotBrought(
  pool: DbPool,
  input: Input & { readonly day?: string },
): Promise<
  | { readonly ok: true; readonly notBrought: ReceiptsNotBrought }
  | { readonly ok: false; readonly code: TonightRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await open(tx, input)
    if (!opened.ok) return opened
    if (!opened.held.has('night.view') && !opened.held.has('night.view_full')) {
      return { ok: false, code: 'permission_denied' } as const
    }
    const day = input.day !== undefined && input.day <= opened.today ? input.day : opened.today
    return {
      ok: true,
      notBrought: await receiptsNotBrought(tx, input.venueId, day),
    } as const
  })
}
