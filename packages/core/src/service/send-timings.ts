// How long each step of a Send may take, and so how long the table's slot lease lasts in each
// state (#77). The worker bounds every wait itself (its turn at the POS instance's budget, each
// read, each write) and ends the read-back on a clock deadline, so a run always settles before its
// lease passes: the sweep settles only a sent order whose worker died, never one still being read
// back. Each lease is derived from the seam's timings, so tuning a timing moves its lease with it.

import { SERVICE_TIMINGS, type ServiceTimings } from '../timings'

/** Tries of the read before the round, and the pause between two. */
export const BEFORE_READ_TRIES = 3
export const BEFORE_READ_PAUSE_MS = 1_000

/**
 * Reads of item availability before the round (#80): one, where the connector declares
 * `itemAvailability`. An incomplete one is not tried again: the POS's refusal still protects.
 */
export const AVAILABILITY_READS = 1

/** How often the table is read back while a round is `checking`. */
export const READ_BACK_EVERY_MS = 5_000

/**
 * The longest a POS call waits for its turn at the instance's budget (one call at a time per
 * instance, shared with the floor reads and other tables' Sends). A call that gets no turn never
 * left: a read is incomplete, a round is Not sent. Starting value, tuned with the budgets.
 */
export const BUDGET_WAIT_MS = 15_000

/** Room for the database steps between POS calls (the state writes, the lease renewals). */
export const LEASE_MARGIN_MS = 15_000

export interface SlotLeaseSeconds {
  /**
   * From `sent_order.start`: the probe the breaker may ask for first (#79, after a write timed
   * out), then the availability read (#80) and the read before the round, with its tries and pauses.
   */
  readonly start: number
  /** From `sending`: the write, and the one more try after a closed bill. */
  readonly sending: number
  /** From `checking`: the read-back window, then the last read it started. */
  readonly checking: number
}

/** The slot lease of each state, in whole seconds, for these timings. */
export function slotLeaseSeconds(timings: ServiceTimings = SERVICE_TIMINGS): SlotLeaseSeconds {
  const read = BUDGET_WAIT_MS + timings.readTimeoutMs
  const write = BUDGET_WAIT_MS + timings.writeTimeoutMs
  const probe = BUDGET_WAIT_MS + timings.probeBudgetMs
  const seconds = (ms: number) => Math.ceil((ms + LEASE_MARGIN_MS) / 1_000)
  return {
    start: seconds(
      probe +
        (AVAILABILITY_READS + BEFORE_READ_TRIES) * read +
        (BEFORE_READ_TRIES - 1) * BEFORE_READ_PAUSE_MS,
    ),
    sending: seconds(2 * write),
    checking: seconds(timings.readBackWindowMs + read),
  }
}
