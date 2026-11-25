import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { DEFAULT_ORDERING_SETTINGS, type ServiceHours } from './ordering-settings'
import { serviceDate } from './service-day'
import {
  guestNight,
  hoursConfigured,
  LAST_ORDERS_NOTICE_MINUTES,
  nextOpening,
  phonesMaySend,
  preOpeningCheckAt,
  serviceNightAt,
} from './service-hours'

const SOFIA = 'Europe/Sofia'
const CLOSED_DAYS = DEFAULT_ORDERING_SETTINGS.serviceHours
const NIGHT = { opens: '22:00', lastOrders: '04:30', closes: '05:30' }
// Fridays and Saturdays are open; the rest of the week is closed.
const HOURS: ServiceHours = { ...CLOSED_DAYS, fri: NIGHT, sat: NIGHT }

const config = (hours: ServiceHours = HOURS, timeZone = SOFIA) => ({
  timeZone,
  dayEndsAt: '07:00',
  hours,
})
const at = (iso: string) => new Date(iso)

// Sofia is UTC+2 in winter (EET) and UTC+3 in summer (EEST). 2026-10-23 is a Friday; summer time
// ends at 04:00 EEST on Sunday 2026-10-25 and starts at 03:00 EET on Sunday 2026-03-29.

describe('hoursConfigured', () => {
  it('is false until a weekday is open', () => {
    expect(hoursConfigured(CLOSED_DAYS)).toBe(false)
    expect(hoursConfigured(HOURS)).toBe(true)
  })
})

describe('serviceNightAt', () => {
  it('belongs a night past midnight to the evening it started, by its weekday', () => {
    // Saturday 2026-10-24 02:00 EEST is still Friday's night.
    const night = serviceNightAt(at('2026-10-23T23:00:00Z'), config())
    expect(night.serviceDate).toBe('2026-10-23')
    expect(night.weekday).toBe('fri')
    expect(night.phase).toBe('open')
  })

  it('walks the night: not open yet, open, last orders soon, ordering closed', () => {
    const phaseAt = (iso: string) => serviceNightAt(at(iso), config()).phase
    // Friday 2026-10-23, summer time (UTC+3): opens 22:00 = 19:00Z.
    expect(phaseAt('2026-10-23T18:59:00Z')).toBe('before_opening')
    expect(phaseAt('2026-10-23T19:00:00Z')).toBe('open')
    // Last orders 04:30 Saturday = 01:30Z; the notice starts 10 minutes before.
    expect(phaseAt('2026-10-24T01:19:59Z')).toBe('open')
    expect(phaseAt('2026-10-24T01:20:00Z')).toBe('last_orders_soon')
    expect(phaseAt('2026-10-24T01:29:59Z')).toBe('last_orders_soon')
    expect(phaseAt('2026-10-24T01:30:00Z')).toBe('ordering_closed')
    expect(LAST_ORDERS_NOTICE_MINUTES).toBe(10)
  })

  it('closes every table at the closing time, not before', () => {
    // Closes 05:30 Saturday = 02:30Z.
    expect(serviceNightAt(at('2026-10-24T02:29:59Z'), config()).tablesClosed).toBe(false)
    expect(serviceNightAt(at('2026-10-24T02:30:00Z'), config()).tablesClosed).toBe(true)
    // Until the service day ends the night stays closed for phones.
    const late = serviceNightAt(at('2026-10-24T03:00:00Z'), config())
    expect(late.phase).toBe('ordering_closed')
    expect(late.serviceDate).toBe('2026-10-23')
  })

  it('has no night on a closed weekday', () => {
    // Thursday 2026-10-22 evening.
    const night = serviceNightAt(at('2026-10-22T19:30:00Z'), config())
    expect(night.weekday).toBe('thu')
    expect(night.hours).toBeNull()
    expect(night.phase).toBe('closed_night')
    expect(night.opensAt).toBeNull()
  })

  it('names the wall-clock times of the venue, not the server', () => {
    const night = serviceNightAt(at('2026-10-23T19:30:00Z'), config())
    expect(night.opensAt?.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    expect(night.lastOrdersAt?.toISOString()).toBe('2026-10-24T01:30:00.000Z')
    expect(night.closesAt?.toISOString()).toBe('2026-10-24T02:30:00.000Z')
  })

  it('reads the same wall-clock night in another zone', () => {
    const night = serviceNightAt(at('2026-10-23T00:00:00Z'), config(HOURS, 'America/New_York'))
    // New York is UTC-4 then: Thursday evening 20:00, service day Thursday.
    expect(night.weekday).toBe('thu')
    const later = serviceNightAt(at('2026-10-24T02:30:00Z'), config(HOURS, 'America/New_York'))
    // 22:30 Friday in New York, 30 minutes after opening.
    expect(later.weekday).toBe('fri')
    expect(later.phase).toBe('open')
    expect(later.opensAt?.toISOString()).toBe('2026-10-24T02:00:00.000Z')
  })

  it('counts the night across the autumn clock change, by the wall clock', () => {
    // Friday 2026-10-23 night into Saturday: no change yet, but Saturday's night crosses it:
    // Sat 2026-10-24 22:00 EEST (19:00Z) to Sun 05:30 EET (03:30Z), 8.5 wall hours, 9.5 real.
    const night = serviceNightAt(at('2026-10-24T20:00:00Z'), config())
    expect(night.weekday).toBe('sat')
    expect(night.opensAt?.toISOString()).toBe('2026-10-24T19:00:00.000Z')
    // 04:30 Sunday is after the clocks went back (UTC+2): 02:30Z.
    expect(night.lastOrdersAt?.toISOString()).toBe('2026-10-25T02:30:00.000Z')
    expect(night.closesAt?.toISOString()).toBe('2026-10-25T03:30:00.000Z')
    // 02:20Z is 04:20 EET: ten minutes of notice still to come.
    expect(serviceNightAt(at('2026-10-25T02:19:00Z'), config()).phase).toBe('open')
    expect(serviceNightAt(at('2026-10-25T02:20:00Z'), config()).phase).toBe('last_orders_soon')
    expect(serviceNightAt(at('2026-10-25T02:30:00Z'), config()).phase).toBe('ordering_closed')
    // The repeated hour (03:00-04:00) neither skips nor doubles the night: still Saturday's.
    expect(serviceNightAt(at('2026-10-25T00:30:00Z'), config()).serviceDate).toBe('2026-10-24')
    expect(serviceNightAt(at('2026-10-25T01:30:00Z'), config()).serviceDate).toBe('2026-10-24')
  })

  it('counts the night across the spring clock change, by the wall clock', () => {
    // Sat 2026-03-28 22:00 EET (20:00Z) to Sun 03-29: 03:00 EET jumps to 04:00 EEST.
    const night = serviceNightAt(at('2026-03-28T21:00:00Z'), config())
    expect(night.weekday).toBe('sat')
    expect(night.opensAt?.toISOString()).toBe('2026-03-28T20:00:00.000Z')
    // 04:30 EEST = 01:30Z, only 5.5 real hours after opening.
    expect(night.lastOrdersAt?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
    expect(night.closesAt?.toISOString()).toBe('2026-03-29T02:30:00.000Z')
  })

  it('puts a time that does not exist (02:30 on the spring change) after the jump', () => {
    // Sunday 2026-03-29: 03:00 EET jumps to 04:00 EEST (01:00Z), so 03:30 EET never happens.
    const jump: ServiceHours = {
      ...CLOSED_DAYS,
      sat: { opens: '22:00', lastOrders: '03:30', closes: '03:45' },
    }
    const night = serviceNightAt(at('2026-03-28T21:00:00Z'), config(jump))
    expect((night.lastOrdersAt as Date).getTime()).toBeGreaterThanOrEqual(
      at('2026-03-29T01:00:00Z').getTime(),
    )
    expect((night.lastOrdersAt as Date).getTime()).toBeLessThanOrEqual(
      at('2026-03-29T01:30:00Z').getTime(),
    )
    // Both are inside the skipped hour, so both are the jump itself: never out of order.
    expect((night.closesAt as Date).getTime()).toBeGreaterThanOrEqual(
      (night.lastOrdersAt as Date).getTime(),
    )
  })

  it('names the next change', () => {
    const before = serviceNightAt(at('2026-10-23T12:00:00Z'), config())
    expect(before.nextChangeAt?.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    const open = serviceNightAt(at('2026-10-23T20:00:00Z'), config())
    expect(open.nextChangeAt?.toISOString()).toBe('2026-10-24T01:20:00.000Z')
    const soon = serviceNightAt(at('2026-10-24T01:25:00Z'), config())
    expect(soon.nextChangeAt?.toISOString()).toBe('2026-10-24T01:30:00.000Z')
    const closed = serviceNightAt(at('2026-10-24T01:45:00Z'), config())
    expect(closed.nextChangeAt?.toISOString()).toBe('2026-10-24T02:30:00.000Z')
  })
})

describe('nextOpening', () => {
  it('finds the next open night, skipping closed weekdays', () => {
    // Monday 2026-10-19 noon: the next open night is Friday 22:00 (19:00Z).
    const next = nextOpening(at('2026-10-19T09:00:00Z'), config())
    expect(next?.serviceDate).toBe('2026-10-23')
    expect(next?.opensAt.toISOString()).toBe('2026-10-23T19:00:00.000Z')
  })

  it('is tonight before opening and the next open night after it', () => {
    expect(nextOpening(at('2026-10-23T12:00:00Z'), config())?.serviceDate).toBe('2026-10-23')
    // Friday 20:00Z is after opening: the next is Saturday.
    expect(nextOpening(at('2026-10-23T20:00:00Z'), config())?.serviceDate).toBe('2026-10-24')
  })

  it('is null when no weekday is open', () => {
    expect(nextOpening(at('2026-10-19T09:00:00Z'), config(CLOSED_DAYS))).toBeNull()
  })
})

describe('preOpeningCheckAt', () => {
  const rule = { startMinutes: 120, everyMinutes: 10, alertMinutes: 30 }
  // Friday 2026-10-23 opens 19:00Z, so the check runs from 17:00Z.
  const checkAt = (iso: string) => preOpeningCheckAt(at(iso), config(), rule)

  it('does nothing before the window or on a closed night', () => {
    expect(checkAt('2026-10-23T16:59:00Z')).toBeNull()
    expect(preOpeningCheckAt(at('2026-10-19T09:00:00Z'), config(CLOSED_DAYS), rule)).toBeNull()
  })

  it('checks from 2 hours before opening, alerting only from 30 minutes before', () => {
    const early = checkAt('2026-10-23T17:00:00Z')
    expect(early).toMatchObject({ serviceDate: '2026-10-23', alert: false })
    expect(early?.opensAt.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    expect(checkAt('2026-10-23T18:29:59Z')?.alert).toBe(false)
    expect(checkAt('2026-10-23T18:30:00Z')?.alert).toBe(true)
    expect(checkAt('2026-10-23T18:59:59Z')?.alert).toBe(true)
  })

  it('stops at opening: the pauses take over', () => {
    expect(checkAt('2026-10-23T19:00:00Z')).toBeNull()
  })

  it('runs on the cadence from the start of the window', () => {
    expect(checkAt('2026-10-23T17:00:00Z')?.slot).toBe(0)
    expect(checkAt('2026-10-23T17:09:59Z')?.slot).toBe(0)
    expect(checkAt('2026-10-23T17:10:00Z')?.slot).toBe(1)
    expect(checkAt('2026-10-23T18:50:00Z')?.slot).toBe(11)
  })

  it('follows the venue settings', () => {
    const custom = { startMinutes: 60, everyMinutes: 15, alertMinutes: 20 }
    expect(preOpeningCheckAt(at('2026-10-23T17:59:00Z'), config(), custom)).toBeNull()
    expect(preOpeningCheckAt(at('2026-10-23T18:00:00Z'), config(), custom)?.alert).toBe(false)
    expect(preOpeningCheckAt(at('2026-10-23T18:40:00Z'), config(), custom)?.alert).toBe(true)
    expect(preOpeningCheckAt(at('2026-10-23T18:30:00Z'), config(), custom)?.slot).toBe(2)
  })

  it('opens at the right hour on the night of the clock change', () => {
    // Saturday 2026-10-24 opens 22:00 EEST = 19:00Z; the clocks change later that night.
    const during = preOpeningCheckAt(at('2026-10-24T17:30:00Z'), config(), rule)
    expect(during?.opensAt.toISOString()).toBe('2026-10-24T19:00:00.000Z')
    // A Sunday night opening after the change (UTC+2): 22:00 = 20:00Z.
    const sunday: ServiceHours = { ...CLOSED_DAYS, sun: NIGHT }
    const after = preOpeningCheckAt(at('2026-10-25T18:00:00Z'), config(sunday), rule)
    expect(after?.opensAt.toISOString()).toBe('2026-10-25T20:00:00.000Z')
  })
})

describe('guestNight', () => {
  const night = (iso: string, hours: ServiceHours = HOURS) =>
    guestNight({ serviceHours: hours }, SOFIA, '07:00', at(iso))

  it('is never gated until the venue has opened a weekday', () => {
    expect(night('2026-10-23T12:00:00Z', CLOSED_DAYS)).toEqual({
      state: 'open',
      at: null,
    })
  })

  it('tells the night in the words of the venue: opening, last orders at …, closed', () => {
    expect(night('2026-10-23T12:00:00Z')).toEqual({
      state: 'opens_later',
      at: '22:00',
    })
    expect(night('2026-10-23T20:00:00Z')).toEqual({ state: 'open', at: null })
    expect(night('2026-10-24T01:20:00Z')).toEqual({
      state: 'last_orders',
      at: '04:30',
    })
    expect(night('2026-10-24T01:30:00Z')).toEqual({
      state: 'closed',
      at: null,
    })
  })

  it('is closed on a closed weekday of a venue that has hours', () => {
    expect(night('2026-10-22T19:30:00Z')).toEqual({
      state: 'closed',
      at: null,
    })
  })

  it('lets phones send only while open or in the last-orders notice', () => {
    expect(phonesMaySend({ state: 'open', at: null })).toBe(true)
    expect(phonesMaySend({ state: 'last_orders', at: '04:30' })).toBe(true)
    expect(phonesMaySend({ state: 'opens_later', at: '22:00' })).toBe(false)
    expect(phonesMaySend({ state: 'closed', at: null })).toBe(false)
  })
})

// Repair-review, hot spot 7: every minute across the clock changes, for any hours of a night. The
// service day never goes back, a phase of the night never goes back, and a table closed stays
// closed; the wall-clock times stay in the order the venue set them.
describe('the night across the clock changes, minute by minute (Europe/Sofia)', () => {
  const ZONE = 'Europe/Sofia'
  const RANK = {
    closed_night: 0,
    before_opening: 0,
    open: 1,
    last_orders_soon: 2,
    ordering_closed: 3,
  } as const
  const clockTime = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
    .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  /** Minutes after the service day's start at 07:00: how the night's times are ordered. */
  const after7 = (time: string) => {
    const [h = 0, m = 0] = time.split(':').map(Number)
    return (h * 60 + m - 7 * 60 + 24 * 60) % (24 * 60)
  }
  const hours = fc
    .uniqueArray(clockTime, { minLength: 3, maxLength: 3, selector: after7 })
    .map((times) => [...times].sort((a, b) => after7(a) - after7(b)))
    .map(([opens, lastOrders, closes]) => ({ opens, lastOrders, closes }) as typeof NIGHT)
  const CHANGES = [
    // The autumn change: 04:00 back to 03:00 on 25 October 2026.
    ['2026-10-24T04:30:00Z', '2026-10-25T05:30:00Z'],
    // The spring change: 03:00 on to 04:00 on 28 March 2027.
    ['2027-03-27T04:30:00Z', '2027-03-28T05:30:00Z'],
  ] as const

  it.each(CHANGES)('walks from %s to %s', (from, to) => {
    fc.assert(
      fc.property(hours, (night) => {
        const clock = {
          timeZone: ZONE,
          dayEndsAt: '07:00',
          hours: Object.fromEntries(
            Object.keys(CLOSED_DAYS).map((day) => [day, night]),
          ) as unknown as ServiceHours,
        }
        let last: ReturnType<typeof serviceNightAt> | null = null
        for (let t = Date.parse(from); t <= Date.parse(to); t += 5 * 60_000) {
          const at = serviceNightAt(new Date(t), clock)
          // Each time of the night belongs to the night it was set for.
          expect(serviceDate(at.opensAt as Date, ZONE, '07:00')).toBe(at.serviceDate)
          expect(serviceDate(at.closesAt as Date, ZONE, '07:00')).toBe(at.serviceDate)
          if (last !== null) {
            expect(at.serviceDate >= last.serviceDate).toBe(true)
            if (at.serviceDate === last.serviceDate) {
              expect(RANK[at.phase]).toBeGreaterThanOrEqual(RANK[last.phase])
              if (last.tablesClosed) expect(at.tablesClosed).toBe(true)
            }
          }
          last = at
        }
      }),
      { numRuns: 40 },
    )
  })

  it('keeps last orders before closing on the spring change: a night of 03:30 and 04:00', () => {
    const night = serviceNightAt(new Date('2027-03-28T00:00:00Z'), {
      timeZone: ZONE,
      dayEndsAt: '07:00',
      hours: Object.fromEntries(
        Object.keys(CLOSED_DAYS).map((day) => [
          day,
          { opens: '22:00', lastOrders: '03:30', closes: '04:00' },
        ]),
      ) as unknown as ServiceHours,
    })
    expect(night.lastOrdersAt?.getTime()).toBeLessThanOrEqual(night.closesAt?.getTime() as number)
  })

  it('never takes the service day back, whatever hour the venue ends its day', () => {
    fc.assert(
      fc.property(clockTime, (dayEndsAt) => {
        let last = ''
        for (
          let t = Date.parse('2026-10-24T20:00:00Z');
          t <= Date.parse('2026-10-25T08:00:00Z');
          t += 5 * 60_000
        ) {
          const day = serviceDate(new Date(t), ZONE, dayEndsAt)
          expect(day >= last, `${new Date(t).toISOString()}: ${day} after ${last}`).toBe(true)
          last = day
        }
      }),
      // 03:15 to 03:45 sit in the repeated hour (Sofia, 25 Oct): each round hits the bug.
      { numRuns: 96, examples: [['03:30']] },
    )
  })

  it('never takes the service day back on the spring change either', () => {
    fc.assert(
      fc.property(clockTime, (dayEndsAt) => {
        let last = ''
        for (
          let t = Date.parse('2027-03-27T20:00:00Z');
          t <= Date.parse('2027-03-28T08:00:00Z');
          t += 5 * 60_000
        ) {
          const day = serviceDate(new Date(t), ZONE, dayEndsAt)
          expect(day >= last, `${new Date(t).toISOString()}: ${day} after ${last}`).toBe(true)
          last = day
        }
      }),
      // 03:00 to 03:59 do not exist on 28 March 2027 in Sofia.
      { numRuns: 96, examples: [['03:30']] },
    )
  })

  it('keeps last orders before closing on the autumn change: a night of 03:30 and 04:00', () => {
    const night = serviceNightAt(new Date('2026-10-24T22:00:00Z'), {
      timeZone: ZONE,
      dayEndsAt: '07:00',
      hours: Object.fromEntries(
        Object.keys(CLOSED_DAYS).map((day) => [
          day,
          { opens: '22:00', lastOrders: '03:30', closes: '04:00' },
        ]),
      ) as unknown as ServiceHours,
    })
    expect(night.lastOrdersAt?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    expect(night.closesAt?.toISOString()).toBe('2026-10-25T02:00:00.000Z')
  })
})
