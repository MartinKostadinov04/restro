// The calls the simulated POS answers for an outside app: POS-shaped, not Restro-shaped (#51
// design §2.1). List tables and bars, read a table's bills and a bill's rows, add rows, move rows
// to a table, void a row, close a bill with a payment, and (where switched on) a one-call sale.
// The wire (`../wire`) maps HTTP onto these; amounts here are minor units, quantities text.

export interface RowIn {
  readonly article: string
  readonly quantity: string
  readonly note: string | null
  readonly options: readonly string[]
  /** The caller's reference on the row (`lineCarriesCallerRef`, Q15). */
  readonly ref: string | null
  /** An amount, only for the tip article (`tipAsLine`, Q41). Restro never sends a price (rule 5). */
  readonly amountMinor: number | null
}

export interface PaymentIn {
  /** A payment type id, or null for the login's default (Q26). */
  readonly type: string | null
  readonly amountMinor: number
}

export type SimCall =
  | { readonly method: 'ping' }
  | { readonly method: 'listTables'; readonly page: number }
  | { readonly method: 'listBars'; readonly page: number }
  | {
      readonly method: 'listBills'
      readonly table: string
      readonly state: 'open' | 'closed'
      readonly page: number
    }
  | { readonly method: 'listOpenBills'; readonly page: number }
  | { readonly method: 'listRows'; readonly bill: string; readonly page: number }
  | {
      readonly method: 'addRows'
      readonly table: string
      /** The bill to add to, or `new` to open one. */
      readonly bill: string
      readonly rows: readonly RowIn[]
      /** The call's reference (`repeatSafeAdd`, Q15). */
      readonly ref: string | null
    }
  | {
      readonly method: 'moveRows'
      readonly bill: string
      readonly rows: readonly { readonly row: string; readonly quantity: string | null }[]
      /** The table to move to: onto its bill (opened if none), a named bill, or a `new` one. */
      readonly to: { readonly table: string; readonly bill: string | null }
    }
  | {
      readonly method: 'voidRow'
      readonly bill: string
      readonly row: string
      readonly quantity: string | null
    }
  | {
      readonly method: 'closeBill'
      readonly bill: string
      readonly payments: readonly PaymentIn[]
      readonly note: string | null
      readonly receiptEmail: string | null
    }
  | {
      readonly method: 'sale'
      readonly table: string
      readonly rows: readonly RowIn[]
      readonly payments: readonly PaymentIn[]
    }

export type SimMethod = SimCall['method']

/** The calls that change nothing: the read allowlist. Every other call is a write. */
export const READ_METHODS: ReadonlySet<SimMethod> = new Set<SimMethod>([
  'ping',
  'listTables',
  'listBars',
  'listBills',
  'listOpenBills',
  'listRows',
])

export function isReadMethod(method: SimMethod): boolean {
  return READ_METHODS.has(method)
}

/** One page of a list: the page asked for, how many pages, how many items in all. */
export type Page<T> = {
  readonly page: number
  readonly pages: number
  readonly count: number
  readonly items: readonly T[]
}
