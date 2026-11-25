// The night's end's rules without a database (#332; D138, D45): the closing hour read from an
// injected clock, the sweep's plan and its idempotence (a property test), and "Put back" with its
// Undo read from the Log.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from '../ordering-settings'
import { type ServiceClock, serviceNightAt } from '../service-hours'
import { endsEarly } from './night-end'
import { countSweep, planSweep } from './reservations/night'
import {
  endedByNightEnd,
  moveStatus,
  NIGHT_END_REASON,
  nightEndStatus,
  PUT_BACK_REASON,
  PUT_BACK_UNDONE_REASON,
  putBack,
  RESERVATION_KINDS,
  RESERVATION_STATUSES,
  type ReservationStatus,
  type StatusEntry,
  undoPutBack,
} from './reservations/status'

const FRIDAY = { opens: '22:00', lastOrders: '04:30', closes: '05:30' }
const clockOf = (hours: Partial<ServiceHours>): ServiceClock => ({
  timeZone: 'Europe/Sofia',
  dayEndsAt: '07:00',
  hours: { ...DEFAULT_ORDERING_SETTINGS.serviceHours, ...hours },
})
const at = (iso: string) => new Date(iso)

describe('the closing hour, on an injected clock', () => {
  const clock = clockOf({ fri: FRIDAY })

  it('ends the night early only before that service day’s closing hour', () => {
    // Friday 23 October 2026, summer time: closes 05:30 Saturday = 02:30Z.
    expect(endsEarly('2026-10-23', at('2026-10-23T23:00:00Z'), clock)).toBe(true)
    expect(endsEarly('2026-10-23', at('2026-10-24T02:29:59Z'), clock)).toBe(true)
    expect(endsEarly('2026-10-23', at('2026-10-24T02:30:00Z'), clock)).toBe(false)
    expect(endsEarly('2026-10-23', at('2026-10-24T03:59:00Z'), clock)).toBe(false)
  })

  it('invents no closing hour: a day with no hours is a closed day', () => {
    // Thursday has no hours: nothing to be early for, and the tick never closes tables there.
    expect(endsEarly('2026-10-22', at('2026-10-22T20:00:00Z'), clock)).toBe(false)
    expect(serviceNightAt(at('2026-10-23T02:00:00Z'), clock)).toMatchObject({
      serviceDate: '2026-10-22',
      closesAt: null,
      tablesClosed: false,
    })
    const none = clockOf({})
    expect(endsEarly('2026-10-23', at('2026-10-23T23:00:00Z'), none)).toBe(false)
  })

  it('belongs the hours after midnight to the night before, until the service day ends (D45)', () => {
    // 06:59 Saturday in Sofia is still Friday's night; 07:00 is Saturday's service day.
    expect(serviceNightAt(at('2026-10-24T03:59:00Z'), clock).serviceDate).toBe('2026-10-23')
    expect(serviceNightAt(at('2026-10-24T04:00:00Z'), clock).serviceDate).toBe('2026-10-24')
    // Past the closing hour and before 07:00 the tables are closed; the night has not passed.
    expect(serviceNightAt(at('2026-10-24T03:00:00Z'), clock).tablesClosed).toBe(true)
  })
})

const anyStatus = fc.constantFrom(...RESERVATION_STATUSES)
const anyKind = fc.constantFrom(...RESERVATION_KINDS)
const anyLines = fc.uniqueArray(fc.record({ id: fc.uuid(), status: anyStatus, kind: anyKind }), {
  selector: (line) => line.id,
  maxLength: 40,
})

describe('the sweep', () => {
  it('finishes the seated, marks no-shows and the still waiting, and leaves a block alone', () => {
    expect(nightEndStatus('seated', 'booking')).toBe('finished')
    expect(nightEndStatus('seated', 'walk_in')).toBe('finished')
    expect(nightEndStatus('reserved', 'booking')).toBe('no_show')
    expect(nightEndStatus('waiting', 'walk_in')).toBe('not_seated')
    expect(nightEndStatus('reserved', 'block')).toBeNull()
    // Requested is part 2's (#323): the night's end does nothing to it.
    expect(nightEndStatus('requested', 'booking')).toBeNull()
    for (const status of ['finished', 'no_show', 'cancelled', 'not_seated'] as const) {
      expect(nightEndStatus(status, 'booking')).toBeNull()
    }
  })

  it('only makes moves the status machine allows', () => {
    fc.assert(
      fc.property(anyStatus, anyKind, (status, kind) => {
        const to = nightEndStatus(status, kind)
        if (to !== null) expect(moveStatus(status, to).ok).toBe(true)
      }),
    )
  })

  it('is idempotent: once applied, a second run by either moment finds nothing to move', () => {
    fc.assert(
      fc.property(anyLines, fc.integer({ min: 1, max: 5 }), (lines, runs) => {
        let night = lines
        const counted = { finished: 0, noShow: 0, notSeated: 0 }
        for (let run = 0; run < runs; run += 1) {
          const moves = planSweep(night)
          const counts = countSweep(moves)
          counted.finished += counts.finished
          counted.noShow += counts.noShow
          counted.notSeated += counts.notSeated
          const to = new Map(moves.map((move) => [move.id, move.to]))
          night = night.map((line) => ({ ...line, status: to.get(line.id) ?? line.status }))
          // From the second run on, nothing moves.
          if (run > 0) expect(moves).toEqual([])
        }
        // So a night's close is counted once, however many times it runs.
        expect(counted).toEqual(countSweep(planSweep(lines)))
        // And no line moved twice.
        expect(planSweep(night)).toEqual([])
      }),
    )
  })
})

describe('putting one reservation back', () => {
  const line = (
    fromState: ReservationStatus | null,
    toState: ReservationStatus,
    reason: string | null,
  ): StatusEntry => ({ fromState, toState, reason })

  it('returns a no-show to Reserved and a party not seated to the queue, nothing else', () => {
    expect(putBack('no_show')).toEqual({ ok: true, status: 'reserved' })
    expect(putBack('not_seated')).toEqual({ ok: true, status: 'waiting' })
    expect(putBack('finished')).toEqual({ ok: false, code: 'put_back_not_allowed' })
    expect(putBack('cancelled')).toEqual({ ok: false, code: 'put_back_not_allowed' })
  })

  it('knows from the Log whether the night’s end or a hostess’s tap ended a party', () => {
    const byNight = [line('reserved', 'no_show', NIGHT_END_REASON)]
    expect(endedByNightEnd(byNight, 'no_show')).toBe(true)
    expect(endedByNightEnd([line('reserved', 'no_show', null)], 'no_show')).toBe(false)
    expect(endedByNightEnd([], 'no_show')).toBe(false)
    // A line that no longer says where the party is proves nothing.
    expect(endedByNightEnd(byNight, 'reserved')).toBe(false)
    // An Undo of a put back gives the party back to the night's end.
    expect(
      endedByNightEnd(
        [
          ...byNight,
          line('no_show', 'reserved', PUT_BACK_REASON),
          line('reserved', 'no_show', PUT_BACK_UNDONE_REASON),
        ],
        'no_show',
      ),
    ).toBe(true)
  })

  it('undoes one put back of a party the night’s end marked, and nothing else', () => {
    const night = [line('waiting', 'not_seated', NIGHT_END_REASON)]
    const back = [...night, line('not_seated', 'waiting', PUT_BACK_REASON)]
    expect(undoPutBack('waiting', back)).toEqual({ ok: true, status: 'not_seated' })
    // The party moved since: the Undo is refused, never guessed at.
    expect(undoPutBack('seated', back)).toEqual({ ok: false, code: 'undo_put_back_not_allowed' })
    expect(undoPutBack('waiting', night)).toEqual({ ok: false, code: 'undo_put_back_not_allowed' })
    // A hostess's own No-show, put back: its undo is her own tap again, not this.
    const own = [line('reserved', 'no_show', null), line('no_show', 'reserved', PUT_BACK_REASON)]
    expect(undoPutBack('reserved', own)).toEqual({ ok: false, code: 'undo_put_back_not_allowed' })
  })
})
