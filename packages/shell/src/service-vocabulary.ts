// The fixed word lists of the services contract (services.ts): pay scopes and methods, receipt
// actions and the statuses of a bill line and a waiter request. They live in a file of their own
// with no imports, so the interface strings (strings.ts) can be keyed by them without a cycle
// (services.ts reaches strings.ts through money.ts). Import them from `./services`.

/** How much of the table a guest pays for. */
export const PAY_SCOPES = ['full', 'split', 'mine'] as const

/** One pay scope: the whole table, an equal share, or only the guest's own items. */
export type PayScope = (typeof PAY_SCOPES)[number]

/** How a guest pays. `waiter` means "I pay the waiter at the table". */
export const PAY_METHODS = ['apple', 'google', 'card', 'waiter'] as const

/** One payment method. */
export type PayMethod = (typeof PAY_METHODS)[number]

/** What a receipt can be turned into. */
export const RECEIPT_ACTIONS = ['pdf', 'email', 'print'] as const

/** One receipt action. */
export type ReceiptAction = (typeof RECEIPT_ACTIONS)[number]

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
  /** Send: the table's menu is not published, so nothing can be priced. */
  'menu_unavailable',
  /** Send: nothing on the order to send. */
  'order_empty',
  /** Send: an item is gone, not orderable or sold out (`subjectId` names it); the order stays. */
  'item_unavailable',
  /** Not available yet. */
  'not_built',
] as const

/** One of the refusal codes a face words. */
export type GuestRefusalCode = (typeof GUEST_REFUSAL_CODES)[number]
