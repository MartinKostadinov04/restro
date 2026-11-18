// The nightly alarm over Restro's own refunds (the 11-18 refund decision, 148): a signal to look, never
// a limit on staff. Martin rejected a ceiling and a manager's PIN ("I am not interested into imposing
// limits"), so this blocks nothing: every refund staff confirm goes through, however many there have
// been, and there is no per-venue switch, no counter that refuses and no disabled button on a busy
// night. (A cut-off past some size of night is an open question for Martin, not built.)
//
// The one figure pair below is the whole of it, in one place. A night is the venue's service day, and
// what counts is the refunds Restro sent that night (a line marked "Not served") against what the
// night captured.

/**
 * The alarm: owners and the Restro team are told, in the night's Log and on the end-of-night page,
 * when a venue's refunds in one service night pass `percent` of that night's captured amount AND
 * number `count` or more. The industry's benchmark is about 0.13 % of sales, so 1 % keeps an
 * ordinary night quiet.
 *
 * Recalibrated after the pilot's first month (148): both figures are starting values, to be set from
 * the pilot's real nights and not before.
 */
export const REFUND_ALARM = { percent: 1, count: 3 } as const

/** What one service night holds. */
export interface RefundNight {
  /** What the night's payments captured, in minor units. */
  readonly capturedMinor: number
  /** What Restro refunded that night (refunds that did not fail), in minor units. */
  readonly refundedMinor: number
  /** How many refunds that is. */
  readonly refundCount: number
}

/** True when `refundedMinor` is more than `percent` percent of `capturedMinor` (integers only, rule 8). */
function pastPercent(night: RefundNight, percent: number): boolean {
  return BigInt(night.refundedMinor) * 100n > BigInt(night.capturedMinor) * BigInt(percent)
}

/** Whether the night's refunds are past the alarm: more than 1 % of what it captured AND three or more. */
export function refundAlarm(night: RefundNight): boolean {
  return pastPercent(night, REFUND_ALARM.percent) && night.refundCount >= REFUND_ALARM.count
}
