// The guest phone's poll gaps that the browser client needs too (so no database import here):
// the fast gap and the idle back-off (P25).

/** The gap while a round or a payment is in flight, or the guest is working (D121). */
export const FAST_POLL_MS = 2_000

/** The longest gap of an idle table. */
export const IDLE_POLL_MAX_MS = 15_000

/**
 * The gap before the next poll while the answers keep coming back `unchanged` and nothing is in
 * flight: it doubles each time, from what the server asked for, up to 15 s. The caller starts again
 * from 0 on any change, any tap of the guest, and keeps `FAST_POLL_MS` while a round or a payment
 * is in flight.
 */
export function idleGap(previousMs: number, servedMs: number): number {
  return Math.min(IDLE_POLL_MAX_MS, Math.max(servedMs, previousMs * 2))
}
