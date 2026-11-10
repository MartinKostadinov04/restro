// What one spot on the floor plan reads as (#327; D134, D135, D137). Pure, so these are unit tests
// with the clock handed in.
//
// Three things the ticket turns on are pinned here:
//
// - **The bill is not in it** (D134, log 1.44): nothing in a hold says anything about a bill, and a
//   seated party with no end of its own keeps its spot until its status leaves Seated. A closed
//   bill is not a status, so it cannot free a spot — the test for it is the absence of any input.
// - **A block with no end stays on** (D137), where the turn time would otherwise lift it.
// - **Every state is a word**, derived each time and stored nowhere.
import { describe, expect, it } from 'vitest'

import {
  holdCoversAt,
  isLateHold,
  LATE_AFTER_MINUTES,
  leadingHold,
  SPOT_STATES,
  type SpotHoldFact,
  spotStateAt,
  spotStateOfNight,
} from './plan-state'

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 7, hour, minute, 0))

/** A hold with everything a party's has; `over` says what this one is. */
function hold(over: Partial<SpotHoldFact> = {}): SpotHoldFact {
  return {
    reservationId: 'rv_1',
    kind: 'booking',
    status: 'reserved',
    stretch: { from: at(22), to: at(24) },
    ownEnd: false,
    startsAt: at(22),
    seatedAt: null,
    name: 'Иванова',
    partySize: 4,
    reason: null,
    openEnded: false,
    ...over,
  }
}

/** A block of the club's own, with its reason; `openEnded` is the one that stays on (D137). */
function block(over: Partial<SpotHoldFact> = {}): SpotHoldFact {
  return hold({
    reservationId: 'rv_block',
    kind: 'block',
    status: 'reserved',
    name: null,
    partySize: null,
    reason: 'repair',
    seatedAt: null,
    ...over,
  })
}

describe('a spot at a moment', () => {
  it('is free with nothing on it', () => {
    expect(spotStateAt([], at(23))).toBe('free')
  })

  it('is free before the hour its booking holds it from', () => {
    expect(spotStateAt([hold()], at(21, 30))).toBe('free')
  })

  it('is held inside its booking and free after it', () => {
    expect(spotStateAt([hold()], at(22, 5))).toBe('held')
    expect(spotStateAt([hold()], at(24))).toBe('free')
  })

  it('is late a quarter of an hour past the hour, and held before that', () => {
    expect(spotStateAt([hold()], at(22, LATE_AFTER_MINUTES - 1))).toBe('held')
    expect(spotStateAt([hold()], at(22, LATE_AFTER_MINUTES))).toBe('late')
  })

  it('is sitting once the party is marked present, whatever the hour says', () => {
    const seated = hold({ status: 'seated', seatedAt: at(21, 40) })
    expect(spotStateAt([seated], at(21, 45))).toBe('sitting')
    // Its hour has long passed and nothing freed it: a party at the table is never late.
    expect(spotStateAt([seated], at(23, 59))).toBe('sitting')
  })

  it('keeps a seated party on the spot past the turn time, with no end of its own', () => {
    // The stretch is the turn time's; the party set no end, so only its status frees the spot.
    const seated = hold({ status: 'seated', seatedAt: at(22), ownEnd: false })
    expect(spotStateAt([seated], at(23, 59))).toBe('sitting')
    expect(holdCoversAt(seated, at(23, 59))).toBe(true)
  })

  it('frees a seated party at the end staff set for it', () => {
    const seated = hold({ status: 'seated', seatedAt: at(22), ownEnd: true })
    expect(spotStateAt([seated], at(23, 59))).toBe('sitting')
    expect(spotStateAt([seated], at(24))).toBe('free')
  })

  it('reads nothing from a bill: a party keeps its spot by its status alone (D134, log 1.44)', () => {
    // There is no bill, no sitting and no money in a hold — the test is that the state is the same
    // whatever a bill did, because nothing about one can be given to this function.
    const seated = hold({ status: 'seated', seatedAt: at(22) })
    expect(Object.keys(seated).some((key) => /bill|sitting|order|pay/i.test(key))).toBe(false)
    expect(spotStateAt([seated], at(23))).toBe('sitting')
  })

  it('holds nothing for a waiting walk-in or a line that ended', () => {
    for (const status of ['waiting', 'finished', 'cancelled', 'no_show'] as const) {
      expect(spotStateAt([hold({ status })], at(22, 30))).toBe('free')
    }
  })

  it('is blocked where a block covers it, before anything else', () => {
    expect(spotStateAt([block()], at(22, 30))).toBe('blocked')
    expect(spotStateAt([block(), hold({ status: 'seated', seatedAt: at(22) })], at(23))).toBe(
      'blocked',
    )
  })

  it('keeps an open-ended block on past the turn time, and until it is lifted (D137)', () => {
    const open = block({ openEnded: true, stretch: { from: at(20), to: at(22) } })
    // Its stretch ended at 22:00; the block has no end, so the spot is still out of use.
    expect(spotStateAt([open], at(23, 59))).toBe('blocked')
    expect(holdCoversAt(open, at(23, 59))).toBe(true)
    // Not before it began, and not once somebody lifted it.
    expect(spotStateAt([open], at(19))).toBe('free')
    expect(spotStateAt([block({ openEnded: true, status: 'cancelled' })], at(23))).toBe('free')
  })

  it('ends a block that was given dates at its own end', () => {
    const dated = block({ stretch: { from: at(20), to: at(22) } })
    expect(spotStateAt([dated], at(21))).toBe('blocked')
    expect(spotStateAt([dated], at(22))).toBe('free')
  })

  it('never calls a block late', () => {
    expect(isLateHold(block({ startsAt: at(20) }), at(23))).toBe(false)
  })

  it('answers with one of the five words and nothing else', () => {
    const cases: readonly SpotHoldFact[][] = [
      [],
      [hold()],
      [hold({ status: 'seated', seatedAt: at(22) })],
      [block()],
      [block({ openEnded: true })],
    ]
    for (const holds of cases) {
      for (const hour of [19, 22, 23, 24]) {
        expect(SPOT_STATES).toContain(spotStateAt(holds, at(hour)))
      }
    }
  })
})

describe('a spot on a night that has passed', () => {
  it('is free where nothing held it, and where everything on it was called off', () => {
    expect(spotStateOfNight([])).toBe('free')
    expect(spotStateOfNight([hold({ status: 'cancelled' })])).toBe('free')
    expect(spotStateOfNight([block({ status: 'cancelled' })])).toBe('free')
  })

  it('is held where it was only ever booked', () => {
    expect(spotStateOfNight([hold()])).toBe('held')
    expect(spotStateOfNight([hold({ status: 'no_show' })])).toBe('held')
  })

  it('is sitting where a party sat at it, finished or not', () => {
    expect(spotStateOfNight([hold({ status: 'seated', seatedAt: at(22) })])).toBe('sitting')
    expect(spotStateOfNight([hold({ status: 'finished', seatedAt: at(22) })])).toBe('sitting')
  })

  it('is blocked where a block kept it out of use', () => {
    expect(spotStateOfNight([block()])).toBe('blocked')
  })

  it('never says late: a night that is over has no hour to be past', () => {
    const holds = [hold({ startsAt: at(20) }), hold({ status: 'no_show', startsAt: at(21) })]
    expect(spotStateOfNight(holds)).toBe('held')
  })
})

describe('the hold that explains the state', () => {
  it('names the block where the spot is blocked', () => {
    const party = hold()
    const out = block()
    expect(leadingHold([party, out], 'blocked', at(22, 30))?.reservationId).toBe('rv_block')
  })

  it('names the party at the table where somebody is sitting', () => {
    const booked = hold({ reservationId: 'rv_later', stretch: { from: at(22), to: at(24) } })
    const sitting = hold({ reservationId: 'rv_here', status: 'seated', seatedAt: at(22) })
    expect(leadingHold([booked, sitting], 'sitting', at(23))?.reservationId).toBe('rv_here')
  })

  it('names the late booking where the spot is late', () => {
    const late = hold({ reservationId: 'rv_late', startsAt: at(22) })
    expect(leadingHold([late], 'late', at(22, 30))?.reservationId).toBe('rv_late')
  })

  it('names nothing on a free spot', () => {
    expect(leadingHold([hold()], 'free', at(19))).toBeNull()
    expect(leadingHold([], 'free', at(22))).toBeNull()
  })
})
