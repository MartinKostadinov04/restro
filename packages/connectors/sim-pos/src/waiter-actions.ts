// D110's declaration for the write module (rule 7): each export and the waiter actions it
// performs. The conformance kit's guard checks it against `./write` from the first commit.

import type { WaiterActionDeclaration } from '@restro/core'

export const SIM_WAITER_ACTIONS = Object.freeze({
  postRows: ['add_round', 'open_bill'],
  moveRows: ['split_or_move_bill'],
  closeBill: ['take_payment'],
} as const) satisfies WaiterActionDeclaration
