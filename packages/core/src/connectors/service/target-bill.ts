// Which POS bill a sent order joins: the platform's rule, which each connector applies the
// safest way its POS allows (D115, refined by D124 §2 and §3, and by verification fix 7+8). Pure:
// a complete reading and the declared capabilities in, the choice out.
//
//   1. Only open POS bills that are not under payment (fix 7+8; `excludeBills` and
//      `paymentInFlight`).
//   2. Where `addToStaffOpenedBill` is not declared, only POS bills Restro itself opened (D124 §3).
//   3. Never a POS bill opened before the current service day (D124 §2). Where the POS gives no
//      opening time (`billOpeningTime` undeclared) the rule can't be checked, and the connector
//      has declared so.
//   4. The oldest of what is left, in the POS's own order (the reading is oldest first).
//   5. None left: open one where `firstItemsOpenBill` is declared and the table may hold another
//      POS bill; else "Ask your waiter to put your first item on" (`needs_first_item`).

import type { ServiceCapabilities } from './capabilities'
import type { PosRef } from './pos-ref'
import type { PosBill } from './schemas'

export type TargetBill =
  | { readonly kind: 'join'; readonly bill: PosRef }
  | { readonly kind: 'open' }
  | { readonly kind: 'refuse'; readonly code: 'needs_first_item' }

export interface TargetBillInput {
  /** The table's open POS bills from a complete reading, oldest first. */
  readonly bills: readonly PosBill[]
  readonly capabilities: ServiceCapabilities
  readonly serviceDayStartsAt: Date
  readonly excludeBills: readonly PosRef[]
}

export function chooseTargetBill(input: TargetBillInput): TargetBill {
  const { capabilities } = input
  const excluded = new Set(input.excludeBills.map((ref) => ref.pos))
  const dayStart = input.serviceDayStartsAt.getTime()

  const joinable = input.bills.filter((bill) => {
    if (bill.paymentInFlight || excluded.has(bill.ref.pos)) return false
    // Undeclared, the POS can't be trusted to accept a round on a waiter's bill: a bill whose
    // opener the POS doesn't say is not taken for Restro's.
    if (!capabilities.addToStaffOpenedBill && bill.openedByRestro !== true) return false
    if (capabilities.billOpeningTime) {
      if (bill.openedAt === null) return false
      if (new Date(bill.openedAt).getTime() < dayStart) return false
    }
    return true
  })

  const oldest = joinable[0]
  if (oldest !== undefined) return { kind: 'join', bill: oldest.ref }

  const mayOpen =
    capabilities.firstItemsOpenBill &&
    (input.bills.length === 0 || capabilities.severalBillsPerTable)
  return mayOpen ? { kind: 'open' } : { kind: 'refuse', code: 'needs_first_item' }
}
