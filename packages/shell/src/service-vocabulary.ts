// The fixed word lists of the services contract (services.ts): pay methods, receipt
// actions and the statuses of a bill line and a waiter request. They live in a file of their own
// with no imports, so the interface strings (strings.ts) can be keyed by them without a cycle
// (services.ts reaches strings.ts through money.ts). Import them from `./services`.

/** What the kitchen has done with one bill line. */
export const BILL_LINE_STATUSES = ['received', 'preparing', 'served', 'cancelled'] as const

/** One bill line status. */
export type BillLineStatus = (typeof BILL_LINE_STATUSES)[number]

/** Where a waiter request stands. Only `on_the_way` may be shown as "on the way". */
export const REQUEST_STATUSES = [
  'sent',
  'accepted',
  'on_the_way',
  'done',
  'cancelled',
  'rejected',
] as const

/** One request status. */
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/**
 * The reasons a guest command is refused that a face words (the shell's `refusals` strings). A
 * code not listed here is worded as a general "That didn't work".
 */
export const GUEST_REFUSAL_CODES = [
  /** The line changed under the guest (another phone): the fresh order is drawn. */
  'order_changed',
  /** The line is held by a payment: it can't be changed or removed. */
  'line_held',
  /** The Undo of a removed line has closed. */
  'undo_expired',
  /** The order holds as many lines as it may. */
  'order_full',
  /** A line holds as many as it may. */
  'quantity_limit',
  /** The tap is too old to apply (the phone was offline). */
  'stale_action',
  /** The table edits its order too fast: wait a moment. */
  'rate_limited',
  /** The table is not open for phones. */
  'table_not_open',
  /** The table's code is no longer its code: scan the table's code again. */
  'code_retired',
  /** The phone must be located first (#76): the face shows the consent screen. */
  'location_needed',
  /** The phone could not be confirmed at the venue (#76): Call a waiter or Cancel. */
  'location_failed',
  /** Turnstile's check at Send failed (#76). */
  'human_check',
  /** Send (#77): ordering is paused at the table, its bar or the venue. */
  'ordering_paused',
  /** Send (#82): the venue's night is not open for phones: before opening, after last orders. */
  'ordering_closed',
  /** Send: the table's menu is not published, so nothing can be priced. */
  'menu_unavailable',
  /** Send: nothing on the order to send. */
  'order_empty',
  /** Send: an item is gone, not orderable or sold out (`subjectId` names it); the order stays. */
  'item_unavailable',
  /**
   * Send (#78): a note or options the POS doesn't take to the ticket, or an item that must have
   * options there (`subjectId` names it): order it from the waiter.
   */
  'order_from_waiter',
  /** Send (#78): the table has no POS bill and only a waiter opens one. */
  'needs_first_item',
  /** Send (#78): the same round went in the last 15 minutes (`subjectId` names it); ask first. */
  'duplicate_order',
  /** Send (#78): over the venue's cap or past its pace; the table pauses for "ask your waiter". */
  'guard_tripped',
  /** Pay (#110, D127): paying in the app is not offered here: "Ask your waiter to pay." */
  'paying_not_offered',
  /** Pay: card payments are paused while ordering goes on. */
  'paying_paused',
  /** Pay: a picked line is already in some phone's payment. */
  'being_paid',
  /** Pay: the bill changed since the phone opened it; the fresh bill is drawn. */
  'bill_changed',
  /** Pay: below the venue's smallest card payment. */
  'below_minimum',
  /** Pay: part of a line, a part-paid bill or a whole-bill discount: the waiter splits it. */
  'ask_waiter_to_split',
  /** Pay: Turnstile's check failed. */
  'turnstile',
  /** Pay: the table's sitting ended. */
  'sitting_ended',
  /** Cancel: the hold is already made, the payment is being processed. */
  'too_late',
  /** Pay: the payment named by the phone's handle is not known. */
  'unknown_payment',
  /** Pay or Send (#113): a tip where the POS cannot record one. */
  'tip_not_offered',
  /** Not available yet. */
  'not_built',
] as const

/** One of the refusal codes a face words. */
export type GuestRefusalCode = (typeof GUEST_REFUSAL_CODES)[number]

/**
 * The states of a payment a paying phone sees (the database's, D127; design §4). `captured` is
 * paid; `released` and the unfinished ones are worded by `payScreen` (paying.ts).
 */
export const PAYMENT_STATES = [
  'requested',
  'priced',
  'awaiting_guest',
  'held',
  'queued',
  'isolated',
  'entered',
  'checked',
  'closed',
  'cancelling',
  'captured',
  'released',
  'unconfirmed',
  'stranded',
  'capture_failed',
] as const

/** One state of a payment. */
export type PaymentState = (typeof PAYMENT_STATES)[number]

/** How a payment ended with nothing charged (the words are `strings.services.paying.ended`). */
export const PAY_ENDS = [
  'busy',
  'paying_paused',
  'check_failed',
  'isolate_refused',
  'no_receipt',
  'expired',
  'cancelled',
  /** Pay-first (#113): the round could not be entered, or an item ran out. */
  'enter_refused',
  'item_unavailable',
  /** Released after the pricing: below the venue's smallest card payment (words carry the amount). */
  'below_minimum',
  /** Pay-first: the round reached the till and the manager ended it "No receipt" (Martin 10-29). */
  'pay_first_unpaid',
  /** Paying was switched off at the venue while the payment waited. */
  'paying_off',
  'other',
] as const

/** One way a payment ended with nothing charged. */
export type PayEnd = (typeof PAY_ENDS)[number]
