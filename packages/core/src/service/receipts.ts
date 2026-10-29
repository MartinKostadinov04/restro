// The reads behind "Bring the receipt" (#200; Tonight screen 1, S7): the paper receipts waiting to
// be brought on Tonight, and the end of the night's list of those never marked Brought. Read-only
// on `withTenant`, our ids and public fields only (rule 3). Each row carries the payment number the
// guest shows (`paymentNumberOf`, #114, made from the payment's id) beside its id.
//
// - Tonight: `alerts.answer`, the right that marks a receipt Brought; the amount is part of the
//   row's words (`r_d`).
// - The end of the night: `night.view`, the first sections' right. It carries no amount (nothing
//   on Telegram shows one), so one list serves the page and the worker's message.

import { type DbPool, withTenant } from '@restro/db'

import { dayOf, open, type ReadInput } from './night-read'
import type { TonightRefusal } from './read'
import {
  type ReceiptsNotBrought,
  type ReceiptToBring,
  receiptsNotBrought,
  receiptsToBring,
} from './receipt-rows'

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
    return { ok: true, receipts: await receiptsToBring(tx, input.venueId, today) } as const
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
