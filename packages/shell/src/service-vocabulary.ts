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
