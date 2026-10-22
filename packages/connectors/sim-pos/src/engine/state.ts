// The simulated POS's whole state: one serialisable object (#51 design §2.2), so a scenario can be
// saved, loaded and replayed. Money is integer minor units, quantities thousandths, times ISO
// text. Ids are text in varied shapes (numbers, text with spaces, uuids; design §7 risk 1).

export interface SimLogin {
  readonly id: string
  readonly password: string
  /** `api`: an outside app's user (Restro's); `waiter`: staff at the POS's front end. */
  readonly kind: 'api' | 'waiter'
  readonly name: string
  /** The bars whose tables it sees and acts on; empty: every bar. */
  readonly bars: readonly string[]
}

export interface SimBar {
  readonly id: string
  readonly name: string
}

export interface SimTable {
  readonly id: string
  /** The label staff and guests see ("7"). */
  readonly number: string
  readonly hall: string
  readonly bar: string
  /** A payment table: only Restro uses it, to take payments (D122 §2). */
  readonly payment: boolean
}

export interface SimArticle {
  readonly id: string
  readonly name: string
  readonly priceMinor: number
  soldOut: boolean
  /** The tip article, usable only with `tipAsLine` (Q41). */
  readonly tip: boolean
}

export interface SimPaymentType {
  readonly id: string
  readonly name: string
  readonly kind: 'cash' | 'card'
}

export interface SimRow {
  readonly id: string
  readonly article: string
  readonly name: string
  /** Thousandths. */
  quantity: number
  readonly unitPriceMinor: number
  /** The row's own total. Never recomputed from quantity × price once split (rule 8). */
  amountMinor: number
  readonly note: string | null
  readonly options: readonly string[]
  readonly by: string
  readonly at: string
  readonly ref: string | null
  /** Waiting for approval at the bar (`approvalAtBar`, Q3, Q14): not on the bill yet. */
  pending: boolean
}

export interface SimPayment {
  readonly type: string
  readonly amountMinor: number
  readonly by: string
  readonly at: string
}

export interface SimBill {
  readonly id: string
  readonly table: string
  state: 'open' | 'closed'
  readonly openedAt: string
  readonly openedBy: string
  rows: SimRow[]
  /** A charge of the bill's own beside its rows (`billTotalDiffersFromLines`, Q37). */
  chargeMinor: number
  lockedBy: string | null
  payments: SimPayment[]
  receipt: { readonly number: string | null; readonly email: string | null } | null
  closedAt: string | null
  /** The service day it was opened in (`closeDay` starts the next). */
  readonly day: number
}

export interface SimTicketRow {
  readonly name: string
  readonly quantity: string
  readonly note: string | null
  readonly options: readonly string[]
}

/** One printed ticket at a bar. */
export interface SimTicket {
  readonly at: string
  readonly bar: string
  readonly table: string
  readonly bill: string
  readonly kind: 'order' | 'move' | 'sale'
  readonly by: string
  readonly rows: readonly SimTicketRow[]
}

export interface SimState {
  seq: number
  day: number
  training: boolean
  printerDown: boolean
  offline: string[]
  readonly logins: SimLogin[]
  readonly bars: SimBar[]
  readonly tables: SimTable[]
  readonly articles: SimArticle[]
  readonly paymentTypes: SimPaymentType[]
  bills: SimBill[]
  tickets: SimTicket[]
  receiptSeq: number
  /** Answers of repeat-safe adds (`repeatSafeAdd`, Q15), by login and call reference. */
  repeats: Record<string, unknown>
}
