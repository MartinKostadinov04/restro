import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { Id } from '../../ids'
import {
  heldStretch,
  holdsSpotAt,
  isSpotConflict,
  overlaps,
  resolveTurnMinutes,
  type SpotClaim,
  type SpotHold,
  type Stretch,
  spotConflict,
  TurnMinutesSchema,
} from './overlap'
import { RESERVATION_STATUSES, type ReservationStatus } from './status'

/** The venue's turn time in these tests: ninety minutes, as a club's would be. */
const TURN = 90

/**
 * Tonight at a fixed hour, so every test reads one clock. A club's night runs past midnight, so an
 * hour before noon is the morning after (the service day, D45), which keeps every stretch below in
 * the order a night really has them.
 */
function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, hour < 12 ? 9 : 8, hour, minute, 0))
}

function claim(over: Partial<SpotClaim> = {}): SpotClaim {
  return {
    reservationId: 'rv_candidate',
    spotIds: ['sp_a'],
    startsAt: at(22),
    endsAt: null,
    turnMinutes: null,
    ...over,
  }
}

function hold(over: Partial<SpotHold> = {}): SpotHold {
  return {
    reservationId: 'rv_sitting',
    spotId: 'sp_a',
    status: 'reserved',
    stretch: { from: at(22), to: at(23, 30) },
    ...over,
  }
}

describe('the turn time', () => {
  it("is one value: the reservation's own, else the venue's", () => {
    expect(resolveTurnMinutes(null, TURN)).toBe(TURN)
    expect(resolveTurnMinutes(120, TURN)).toBe(120)
  })

  it('is a positive whole number of minutes, with no default invented here', () => {
    expect(TurnMinutesSchema.safeParse(90).success).toBe(true)
    expect(TurnMinutesSchema.safeParse(0).success).toBe(false)
    expect(TurnMinutesSchema.safeParse(-30).success).toBe(false)
    expect(TurnMinutesSchema.safeParse(45.5).success).toBe(false)
  })
})

describe('heldStretch', () => {
  it("runs the turn time from the reservation's hour", () => {
    const stretch = heldStretch(claim(), TURN)
    expect(stretch.ok && stretch.stretch).toEqual({ from: at(22), to: at(23, 30) })
  })

  it("takes the reservation's own end time over the turn time", () => {
    const stretch = heldStretch(claim({ endsAt: at(1), turnMinutes: 30 }), TURN)
    expect(stretch.ok && stretch.stretch.to).toEqual(at(1))
  })

  it('refuses an end time at or before the start', () => {
    expect(heldStretch(claim({ endsAt: at(22) }), TURN)).toEqual({
      ok: false,
      code: 'end_before_start',
    })
    expect(heldStretch(claim({ endsAt: at(21) }), TURN)).toEqual({
      ok: false,
      code: 'end_before_start',
    })
  })
})

describe('overlaps', () => {
  it('is half-open, so a booking may start when the one before it ends', () => {
    const first: Stretch = { from: at(20), to: at(21, 30) }
    const next: Stretch = { from: at(21, 30), to: at(23) }
    expect(overlaps(first, next)).toBe(false)
    expect(overlaps(next, first)).toBe(false)
  })

  it('is true for a shared moment, either way round', () => {
    const first: Stretch = { from: at(20), to: at(21, 30) }
    const inside: Stretch = { from: at(21), to: at(22) }
    expect(overlaps(first, inside)).toBe(true)
    expect(overlaps(inside, first)).toBe(true)
  })
})

describe('spotConflict', () => {
  it('names the reservation holding the spot', () => {
    const conflict = spotConflict(claim(), [hold()], TURN)
    expect(isSpotConflict(conflict)).toBe(true)
    expect(conflict).toEqual({ spotId: 'sp_a', reservationId: 'rv_sitting' })
  })

  it('leaves a spot free once the turn time has passed', () => {
    const conflict = spotConflict(claim({ startsAt: at(23, 30) }), [hold()], TURN)
    expect(conflict).toBeNull()
  })

  it('never puts a reservation in its own way, so an edit keeps its spot', () => {
    const mine = hold({ reservationId: 'rv_candidate' })
    expect(spotConflict(claim({ startsAt: at(22, 30) }), [mine], TURN)).toBeNull()
  })

  it('ignores a holder whose status holds no spot', () => {
    for (const status of RESERVATION_STATUSES.filter(
      (candidate) =>
        candidate !== 'requested' && candidate !== 'reserved' && candidate !== 'seated',
    )) {
      expect(spotConflict(claim(), [hold({ status })], TURN)).toBeNull()
    }
  })

  it('refuses for a party at the table, whose spots are not free for a later booking', () => {
    const seated = hold({ status: 'seated', stretch: { from: at(21), to: at(22, 30) } })
    expect(spotConflict(claim(), [seated], TURN)).toEqual({
      spotId: 'sp_a',
      reservationId: 'rv_sitting',
    })
  })

  it('names the spot the person tapped first, not the first row it found', () => {
    const holds = [
      hold({ reservationId: 'rv_one', spotId: 'sp_b' }),
      hold({ reservationId: 'rv_two', spotId: 'sp_a' }),
    ]
    expect(spotConflict(claim({ spotIds: ['sp_a', 'sp_b'] }), holds, TURN)).toEqual({
      spotId: 'sp_a',
      reservationId: 'rv_two',
    })
  })

  it("passes the claim's own refusal through instead of a spot", () => {
    const refused = spotConflict(claim({ endsAt: at(20) }), [hold()], TURN)
    expect(isSpotConflict(refused)).toBe(false)
    expect(refused).toEqual({ code: 'end_before_start' })
  })
})

/** A night's reservations as fast-check makes them: an hour, a length and a spot. */
const anyClaim = fc
  .record({
    index: fc.integer({ min: 0, max: 40 }),
    startMinutes: fc.integer({ min: 0, max: 600 }),
    turnMinutes: fc.integer({ min: 15, max: 240 }),
    spot: fc.constantFrom<Id<'sp'>>('sp_a', 'sp_b', 'sp_c'),
  })
  .map(({ index, startMinutes, turnMinutes, spot }) => ({
    reservationId: `rv_${index}` as Id<'rv'>,
    spotIds: [spot],
    startsAt: new Date(at(20).getTime() + startMinutes * 60_000),
    endsAt: null,
    turnMinutes,
  }))

describe('the overlap rule as a property', () => {
  it('never lets two accepted reservations hold one spot at one moment', () => {
    fc.assert(
      fc.property(fc.array(anyClaim, { maxLength: 12 }), (claims) => {
        const accepted: SpotHold[] = []
        for (const candidate of claims) {
          if (accepted.some((taken) => taken.reservationId === candidate.reservationId)) continue
          const conflict = spotConflict(candidate, accepted, TURN)
          if (conflict !== null) continue
          const stretch = heldStretch(candidate, TURN)
          if (!stretch.ok) continue
          accepted.push({
            reservationId: candidate.reservationId,
            spotId: candidate.spotIds[0] as Id<'sp'>,
            status: 'reserved',
            stretch: stretch.stretch,
          })
        }
        for (const one of accepted) {
          for (const other of accepted) {
            if (one.reservationId === other.reservationId) continue
            if (one.spotId !== other.spotId) continue
            expect(overlaps(one.stretch, other.stretch)).toBe(false)
          }
        }
      }),
    )
  })

  it('always names a reservation that is really in the list', () => {
    fc.assert(
      fc.property(anyClaim, fc.array(anyClaim, { maxLength: 6 }), (candidate, others) => {
        const held: SpotHold[] = others
          .filter((other) => other.reservationId !== candidate.reservationId)
          .flatMap((other) => {
            const stretch = heldStretch(other, TURN)
            return stretch.ok
              ? [
                  {
                    reservationId: other.reservationId,
                    spotId: other.spotIds[0] as Id<'sp'>,
                    status: 'reserved' as ReservationStatus,
                    stretch: stretch.stretch,
                  },
                ]
              : []
          })
        const conflict = spotConflict(candidate, held, TURN)
        if (!isSpotConflict(conflict)) return
        expect(held.map((one) => one.reservationId)).toContain(conflict.reservationId)
        expect(candidate.spotIds).toContain(conflict.spotId)
      }),
    )
  })

  it('refuses the same pair whichever of the two was booked first', () => {
    fc.assert(
      fc.property(anyClaim, anyClaim, (one, other) => {
        if (one.reservationId === other.reservationId) return
        const stretchOf = (candidate: SpotClaim): SpotHold | null => {
          const stretch = heldStretch(candidate, TURN)
          return stretch.ok
            ? {
                reservationId: candidate.reservationId,
                spotId: candidate.spotIds[0] as Id<'sp'>,
                status: 'reserved',
                stretch: stretch.stretch,
              }
            : null
        }
        const first = stretchOf(one)
        const second = stretchOf(other)
        if (first === null || second === null) return
        expect(isSpotConflict(spotConflict(one, [second], TURN))).toBe(
          isSpotConflict(spotConflict(other, [first], TURN)),
        )
      }),
    )
  })
})

describe('holdsSpotAt: what the floor plan reads', () => {
  const stretch: Stretch = { from: at(22), to: at(23, 30) }

  it("keeps a booking's spot for its stretch only", () => {
    expect(holdsSpotAt({ status: 'reserved', stretch, ownEnd: false }, at(21))).toBe(false)
    expect(holdsSpotAt({ status: 'reserved', stretch, ownEnd: false }, at(22))).toBe(true)
    expect(holdsSpotAt({ status: 'reserved', stretch, ownEnd: false }, at(23, 29))).toBe(true)
    expect(holdsSpotAt({ status: 'reserved', stretch, ownEnd: false }, at(23, 30))).toBe(false)
  })

  it("holds a seated party's spot before its hour, so a party seated early never reads free", () => {
    expect(holdsSpotAt({ status: 'seated', stretch, ownEnd: false }, at(21))).toBe(true)
  })

  it("holds a seated party's spot past the turn time: the turn time never frees a table", () => {
    expect(holdsSpotAt({ status: 'seated', stretch, ownEnd: false }, at(2))).toBe(true)
  })

  it("frees a seated party's spot at the end time staff set themselves", () => {
    expect(holdsSpotAt({ status: 'seated', stretch, ownEnd: true }, at(23, 29))).toBe(true)
    expect(holdsSpotAt({ status: 'seated', stretch, ownEnd: true }, at(23, 30))).toBe(false)
  })

  it('holds nothing for a waiting walk-in or an ended reservation', () => {
    for (const status of ['waiting', 'finished', 'no_show', 'cancelled', 'not_seated'] as const) {
      expect(holdsSpotAt({ status, stretch, ownEnd: false }, at(22, 30))).toBe(false)
    }
  })

  it('takes no bill, payment or sitting: a closed bill cannot free a spot (D134, log 1.44)', () => {
    // The whole argument is the status, the stretch and the clock. There is no field a bill could
    // be read from, so the plan of ticket #327 cannot derive a free spot from a closed bill.
    const seated = { status: 'seated' as ReservationStatus, stretch, ownEnd: false }
    expect(Object.keys(seated).sort()).toEqual(['ownEnd', 'status', 'stretch'])
    expect(holdsSpotAt(seated, at(3))).toBe(true)
  })
})
