import { describe, expect, it } from 'vitest'

import { SERVICE_TIMINGS } from '../timings'
import {
  BEFORE_READ_PAUSE_MS,
  BEFORE_READ_TRIES,
  BUDGET_WAIT_MS,
  LEASE_MARGIN_MS,
  slotLeaseSeconds,
} from './send-timings'
import { SLOT_CHECKING_SECONDS, SLOT_SENDING_SECONDS, SLOT_START_SECONDS } from './sent-order'

describe('the slot lease of each state', () => {
  it('outlasts the slowest run of its step, with a margin', () => {
    const read = BUDGET_WAIT_MS + SERVICE_TIMINGS.readTimeoutMs
    const write = BUDGET_WAIT_MS + SERVICE_TIMINGS.writeTimeoutMs
    const probe = BUDGET_WAIT_MS + SERVICE_TIMINGS.probeBudgetMs
    const lease = slotLeaseSeconds()
    // The breaker's probe before the read (#79), then the read with its tries and pauses.
    expect(lease.start * 1_000).toBeGreaterThanOrEqual(
      probe +
        BEFORE_READ_TRIES * read +
        (BEFORE_READ_TRIES - 1) * BEFORE_READ_PAUSE_MS +
        LEASE_MARGIN_MS,
    )
    // The write, and its one more try after a closed bill.
    expect(lease.sending * 1_000).toBeGreaterThanOrEqual(2 * write + LEASE_MARGIN_MS)
    // The window, and the last read it started.
    expect(lease.checking * 1_000).toBeGreaterThanOrEqual(
      SERVICE_TIMINGS.readBackWindowMs + read + LEASE_MARGIN_MS,
    )
  })

  it('is what the engine holds the slot for', () => {
    expect({
      start: SLOT_START_SECONDS,
      sending: SLOT_SENDING_SECONDS,
      checking: SLOT_CHECKING_SECONDS,
    }).toEqual(slotLeaseSeconds(SERVICE_TIMINGS))
  })

  it('moves with the timings', () => {
    const longer = { ...SERVICE_TIMINGS, readBackWindowMs: 120_000 }
    expect(slotLeaseSeconds(longer).checking).toBe(slotLeaseSeconds().checking + 60)
    const slowerProbe = { ...SERVICE_TIMINGS, probeBudgetMs: SERVICE_TIMINGS.probeBudgetMs + 5_000 }
    expect(slotLeaseSeconds(slowerProbe).start).toBe(slotLeaseSeconds().start + 5)
  })
})
