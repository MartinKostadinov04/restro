// What every face that draws the table's shared order says and works out the same way (D117, D121,
// D122 §5; #75 to #80): the words of a sent order's state, the duplicate check's minutes, the clock
// a waiter reads, and the items of the view by id. Pure; a face keeps its own look and its own
// hooks and imports these so the platform's words and rules live in one place.

import type { SentOrderView } from './services'
import type { ServiceStrings } from './strings'
import type { ViewItem, ViewModel } from './view-model'

/** How long the duplicate check stays open (D117: "auto-closes after 60 s"). */
export const DUPLICATE_ASK_SECONDS = 60

/** Every item of the view by id (the first placement wins), for an order's names. */
export function itemsById(view: ViewModel): ReadonlyMap<string, ViewItem> {
  const found = new Map<string, ViewItem>()
  const walk = (sections: ViewModel['sections']) => {
    for (const section of sections) {
      for (const item of section.items) if (!found.has(item.id)) found.set(item.id, item)
      walk(section.sections)
    }
  }
  walk(view.sections)
  return found
}

/** What a sent order says on this phone (D116, D122 §5). */
export function sentWords(sent: SentOrderView, strings: ServiceStrings): string {
  switch (sent.state) {
    case 'sending':
      return sent.mine ? strings.sendingNow : strings.beingSent
    case 'awaiting_approval':
      return strings.sentAwaitingApproval
    case 'added':
      return sent.unpaid === true ? strings.sentUnpaid : strings.sentAdded
    case 'not_sent':
      if (sent.reason === 'ordering_paused') return strings.sentNotSentPaused
      if (sent.reason === 'item_unavailable') return strings.sentNotSentOutOfStock
      return sent.reason === 'needs_first_item' ? strings.sentNotSentFirstItem : strings.sentNotSent
    case 'unconfirmed':
      return strings.sentUnconfirmed(sent.ref)
  }
}

/** Whole minutes since the table sent `sentOrderId`, or null when this phone doesn't see it. */
export function minutesSinceSent(
  sentOrders: readonly SentOrderView[],
  sentOrderId: string,
  now: number,
): number | null {
  const sent = sentOrders.find((order) => order.id === sentOrderId)
  return sent === undefined ? null : Math.max(0, Math.floor((now - sent.sentAt) / 60_000))
}
