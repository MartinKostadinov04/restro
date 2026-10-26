// Which lines of the table's order are out of stock (#80, D122 §4 Stock): what every face greys
// and leaves out of the next Send. Pure.
//
// An item is out of stock when the view says it is sold out (the live overlay, every phone at its
// next poll), or when the table's newest sent order ended Not sent because the POS said that item
// ran out (`item_unavailable`, its lines flagged). The second holds the moment the sent order
// settles, before the overlay catches up; the next Send, of the rest, ends it.

import type { SentOrderView } from './services'
import type { ViewItem } from './view-model'

/** The items of the newest sent order that the POS said ran out; empty when it said nothing. */
export function refusedOutOfStock(sentOrders: readonly SentOrderView[] = []): ReadonlySet<string> {
  const newest = sentOrders[0]
  if (newest === undefined || newest.state !== 'not_sent' || newest.reason !== 'item_unavailable') {
    return new Set()
  }
  return new Set(newest.lines.flatMap((line) => (line.outOfStock === true ? [line.itemId] : [])))
}

/** Whether an order line's item is out of stock now. */
export function isOutOfStock(
  itemId: string,
  item: ViewItem | undefined,
  refused: ReadonlySet<string>,
): boolean {
  return refused.has(itemId) || item?.state.code === 'sold_out'
}
