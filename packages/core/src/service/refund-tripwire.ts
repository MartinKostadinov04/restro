// The nightly tripwire of Restro's own refunds (the 11-18 refund decision, 148): a check against a
// leaked key or a bug, never a limit on staff. Martin rejected a ceiling and a manager's PIN ("I am
// not interested into imposing limits"), so a refund staff have confirmed is never blocked by it;
// the switch-off only stops new ones from inside Restro. The venue's own provider dashboard keeps
// working, and an owner switches the route back on (`payment_account.refund_route_on`).
//
// The two figures below are the whole of it, in one place. A night is the venue's service day, and
// what counts is the refunds Restro sent that night (a line marked "Not served") against what the
// night captured.

/**
 * The alarm: owners and the Restro team are told when a venue's refunds in one service night pass
 * `percent` of that night's captured amount AND number `count` or more. The industry's benchmark
 * is about 0.13 % of sales, so 1 % keeps an ordinary night quiet.
 *
 * Recalibrated after the pilot's first month (148): both figures are starting values, to be set from
 * the pilot's real nights and not before.
 */
export const REFUND_ALARM = { percent: 1, count: 3 } as const

/**
 * The switch-off: past `percent` of the night's captured amount OR `count` refunds, whichever comes
 * first, Restro's own refunds are switched off at the venue until an owner switches them back on.
 *
 * Recalibrated after the pilot's first month (148), together with {@link REFUND_ALARM}.
 */
export const REFUND_SWITCH_OFF = { percent: 5, count: 15 } as const

/** What one service night holds. */
export interface RefundNight {
  /** What the night's payments captured, in minor units. */
  readonly capturedMinor: number
  /** What Restro refunded that night (refunds that did not fail), in minor units. */
  readonly refundedMinor: number
  /** How many refunds that is. */
  readonly refundCount: number
}

/** What the tripwire says about a night. */
export type RefundTripwire = 'quiet' | 'alarm' | 'switch_off'

/** True when `refundedMinor` is more than `percent` percent of `capturedMinor` (integers only, rule 8). */
function pastPercent(night: RefundNight, percent: number): boolean {
  return BigInt(night.refundedMinor) * 100n > BigInt(night.capturedMinor) * BigInt(percent)
}

/**
 * Where the night stands. The switch-off wins over the alarm: past 5 % or fifteen refunds the
 * route goes off (and the owners are told it did); past 1 % with three or more, only the alarm.
 */
export function refundTripwire(night: RefundNight): RefundTripwire {
  if (
    pastPercent(night, REFUND_SWITCH_OFF.percent) ||
    night.refundCount >= REFUND_SWITCH_OFF.count
  ) {
    return 'switch_off'
  }
  if (pastPercent(night, REFUND_ALARM.percent) && night.refundCount >= REFUND_ALARM.count) {
    return 'alarm'
  }
  return 'quiet'
}
