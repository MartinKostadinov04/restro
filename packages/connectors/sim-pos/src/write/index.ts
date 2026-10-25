// The connector's write module: every call that can change the simulated POS, and nothing else
// (D110, rule 7). Each export is declared with the waiter actions it performs in
// `../waiter-actions.ts`; the conformance kit fails on an export that isn't. There is no call
// for items, prices, settings or users, and none is to be added.

import { type Sent, type SimClient, segment } from '../client'

export interface RowOut {
  readonly article: string
  readonly quantity: string
  readonly note?: string | null
  readonly options?: readonly string[]
  readonly ref?: string
  /** Only on a row of the tip article, as part of a close (D127): never a price (rule 5). */
  readonly amount?: string
}

/**
 * A round onto a table's bill, or onto a new one (`bill: 'new'`): add a round, open a bill. The
 * tip row of a close goes through it too, as a waiter keys the tip in at the till (D110).
 */
export function postRows(
  client: SimClient,
  table: string,
  body: { readonly bill: string; readonly rows: readonly RowOut[]; readonly ref?: string },
  signal: AbortSignal,
): Promise<Sent> {
  return client.post(`/api/tables/${segment(table)}/rows`, body, signal)
}

/** Rows (or part of a row's quantity) moved to another table's bill, or split off: move a bill. */
export function moveRows(
  client: SimClient,
  bill: string,
  body: {
    readonly rows: readonly { readonly row: string; readonly quantity?: string }[]
    readonly to: { readonly table: string; readonly bill?: string }
  },
  signal: AbortSignal,
): Promise<Sent> {
  return client.post(`/api/bills/${segment(bill)}/move`, body, signal)
}

/** A bill closed with its payment: take a payment. */
export function closeBill(
  client: SimClient,
  bill: string,
  body: { readonly payments: readonly { readonly type?: string; readonly amount: string }[] },
  signal: AbortSignal,
): Promise<Sent> {
  return client.post(`/api/bills/${segment(bill)}/close`, body, signal)
}
