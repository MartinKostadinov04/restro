// Rule 7 as data (D110): Restro writes into a POS only as a waiter would. Every write a
// connector offers is declared as one of these waiter actions, and the conformance kit's guard
// fails on any write that is not: no items, prices, settings or users, no webhooks, no POS
// registration (D41). A new waiter action is a decision, not a code change.

/** The waiter actions of D110's rule 7, in its words. */
export const WAITER_ACTIONS = [
  'open_bill',
  'add_round',
  'split_or_move_bill',
  'take_payment',
  'ask_for_bill_or_receipt',
  'cancel_within_pos_rules',
] as const

/** One waiter action. */
export type WaiterAction = (typeof WAITER_ACTIONS)[number]

/** True if `value` is one of D110's waiter actions. */
export function isWaiterAction(value: unknown): value is WaiterAction {
  return typeof value === 'string' && (WAITER_ACTIONS as readonly string[]).includes(value)
}

/** The interface's write steps and the waiter actions each one is. */
export const SERVICE_WRITE_STEPS = {
  addLines: ['add_round', 'open_bill'],
  isolateLines: ['split_or_move_bill'],
  payAndClose: ['take_payment'],
  undoIsolate: ['split_or_move_bill'],
} as const satisfies Record<string, readonly WaiterAction[]>

/** The interface's read steps: none of them may write (the probe least of all). */
export const SERVICE_READ_STEPS = [
  'probe',
  'readFloor',
  'readTable',
  'readIsolated',
  'readAvailability',
] as const

export type ServiceWriteStep = keyof typeof SERVICE_WRITE_STEPS
export type ServiceReadStep = (typeof SERVICE_READ_STEPS)[number]

/**
 * A connector package's declaration of its write module's exports (D110: "a test that every
 * exported write is declared as one of the waiter actions"): export name → the waiter actions it
 * performs. The kit fails on an export without one and on a declaration naming anything else.
 */
export type WaiterActionDeclaration = Readonly<Record<string, readonly WaiterAction[]>>
