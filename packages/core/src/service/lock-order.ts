// The one fixed order every service write locks its rows in (design §2.3, D117), so two writers
// can never deadlock: the sitting first, then the table's order, then sent orders, then the lease
// rows, then everything else. Inside one kind, rows are locked in the order of their keys. A
// transaction that asks for a row out of this order is a programming error and throws before the
// database is asked, so a wrong order is found by the first test that runs it, not by a deadlock
// on a busy night.
//
// Pure: no I/O. `rows.ts` asks the ledger before every `FOR UPDATE` / `FOR SHARE`.

/**
 * The kinds of row, in locking order. The venue row comes before all of them (`lockLiveVenue`,
 * taken by the engine at the start of every command).
 */
export const LOCK_RANKS = [
  'sitting',
  'table_order',
  'sent_order',
  'lease',
  'bill_reading',
  'waiter_call',
  'pause',
  'alert',
  'staff',
] as const

/** One kind of row. */
export type LockRank = (typeof LOCK_RANKS)[number]

/** A row asked for out of the fixed order. */
export class LockOrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LockOrderError'
  }
}

/** The rows one transaction holds, and the check that the next one keeps the order. */
export class LockLedger {
  #rank = -1
  #lastKey: string | null = null
  readonly #held = new Set<string>()

  /** True when this transaction already holds the row. */
  holds(rank: LockRank, key: string): boolean {
    return this.#held.has(`${rank}:${key}`)
  }

  /**
   * Records that the transaction is about to lock these rows of one kind, and throws
   * `LockOrderError` when that breaks the order. Rows already held are skipped; the rest must come
   * after everything held so far. Returns the keys still to lock, sorted.
   */
  claim(rank: LockRank, keys: readonly string[]): string[] {
    const index = LOCK_RANKS.indexOf(rank)
    const fresh = [...new Set(keys)].filter((key) => !this.holds(rank, key)).sort(compareKeys)
    if (fresh.length === 0) return []
    if (index < this.#rank) {
      throw new LockOrderError(
        `a ${rank} row is locked after a ${LOCK_RANKS[this.#rank]} row; the order is ${LOCK_RANKS.join(' → ')}`,
      )
    }
    const first = fresh[0] as string
    if (index === this.#rank && this.#lastKey !== null && compareKeys(first, this.#lastKey) < 0) {
      throw new LockOrderError(
        `${rank} rows are locked out of key order (${first} after ${this.#lastKey}); lock them in one call`,
      )
    }
    for (const key of fresh) this.#held.add(`${rank}:${key}`)
    this.#rank = index
    this.#lastKey = fresh[fresh.length - 1] as string
    return fresh
  }
}

/** Keys compare by code unit, like Postgres's `C` collation: never by a language's rules. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
