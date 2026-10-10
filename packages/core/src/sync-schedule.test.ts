import { describe, expect, it } from 'vitest'

import { dueSyncs, fullPullSlotToday, nextSyncRuns, type SyncScheduleState } from './sync-schedule'
import { type ScheduleSettings, SYNC_DEFAULTS } from './sync-settings'

const SOFIA = 'Europe/Sofia'
const at = (iso: string) => new Date(iso)
const settings = (patch: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  ...SYNC_DEFAULTS.schedule,
  ...patch,
})
const iso = (date: Date | null) => date?.toISOString() ?? null

describe('fullPullSlotToday: the venue-local time on the venue-local date', () => {
  it.each([
    // [what, now, time, zone, expected instant]
    ['winter, UTC+2', '2026-01-15T08:00:00Z', '12:00', SOFIA, '2026-01-15T10:00:00.000Z'],
    ['summer, UTC+3', '2026-07-15T08:00:00Z', '12:00', SOFIA, '2026-07-15T09:00:00.000Z'],
    // The local date, not the UTC date: 23:30 on 9 Oct in Sofia is still 9 Oct (20:30 UTC).
    [
      'the local date near UTC midnight',
      '2026-10-09T21:30:00Z',
      '12:00',
      SOFIA,
      '2026-10-10T09:00:00.000Z',
    ],
    ['local midnight (00:00)', '2026-10-09T22:00:00Z', '00:00', SOFIA, '2026-10-09T21:00:00.000Z'],
    [
      'the last minute of the day (23:59)',
      '2026-10-10T10:00:00Z',
      '23:59',
      SOFIA,
      '2026-10-10T20:59:00.000Z',
    ],
  ])('%s', (_what, now, time, zone, expected) => {
    expect(iso(fullPullSlotToday(at(now), zone, time))).toBe(expected)
  })

  describe('daylight saving, Europe/Sofia (clocks go 03:00 -> 04:00 on 2026-03-29, 04:00 -> 03:00 on 2026-10-25)', () => {
    it('spring: the day before and the day after are normal, the day itself has 23 hours', () => {
      expect(iso(fullPullSlotToday(at('2026-03-28T08:00:00Z'), SOFIA, '12:00'))).toBe(
        '2026-03-28T10:00:00.000Z',
      ) // 12:00 EET
      expect(iso(fullPullSlotToday(at('2026-03-29T08:00:00Z'), SOFIA, '12:00'))).toBe(
        '2026-03-29T09:00:00.000Z',
      ) // 12:00 EEST
    })

    it('spring: a time before the jump exists as it is', () => {
      expect(iso(fullPullSlotToday(at('2026-03-29T05:00:00Z'), SOFIA, '02:30'))).toBe(
        '2026-03-29T00:30:00.000Z',
      ) // 02:30 EET
      expect(iso(fullPullSlotToday(at('2026-03-29T05:00:00Z'), SOFIA, '04:00'))).toBe(
        '2026-03-29T01:00:00.000Z',
      ) // 04:00 EEST, the first minute after the jump
    })

    it('spring: a time inside the skipped hour is shifted forward by the jump', () => {
      expect(iso(fullPullSlotToday(at('2026-03-29T05:00:00Z'), SOFIA, '03:30'))).toBe(
        '2026-03-29T01:30:00.000Z',
      ) // read as 04:30 EEST
      expect(iso(fullPullSlotToday(at('2026-03-29T05:00:00Z'), SOFIA, '03:00'))).toBe(
        '2026-03-29T01:00:00.000Z',
      ) // 04:00 EEST
    })

    it('autumn: a time inside the repeated hour is the first of the two', () => {
      expect(iso(fullPullSlotToday(at('2026-10-25T05:00:00Z'), SOFIA, '03:30'))).toBe(
        '2026-10-25T00:30:00.000Z',
      ) // 03:30 EEST, not 03:30 EET (01:30 UTC)
      expect(iso(fullPullSlotToday(at('2026-10-25T05:00:00Z'), SOFIA, '04:00'))).toBe(
        '2026-10-25T02:00:00.000Z',
      ) // 04:00 EET, after the repeated hour
    })

    it('autumn: noon after the change is on winter time', () => {
      expect(iso(fullPullSlotToday(at('2026-10-25T08:00:00Z'), SOFIA, '12:00'))).toBe(
        '2026-10-25T10:00:00.000Z',
      )
      expect(iso(fullPullSlotToday(at('2026-10-24T08:00:00Z'), SOFIA, '12:00'))).toBe(
        '2026-10-24T09:00:00.000Z',
      )
    })
  })

  it('works the same in a zone that changes at another hour (America/New_York)', () => {
    const newYork = 'America/New_York'
    // 2026-03-08: 02:00 EST -> 03:00 EDT. 02:30 does not exist: read as 03:30 EDT = 07:30 UTC.
    expect(iso(fullPullSlotToday(at('2026-03-08T15:00:00Z'), newYork, '02:30'))).toBe(
      '2026-03-08T07:30:00.000Z',
    )
    // 2026-11-01: 02:00 EDT -> 01:00 EST. 01:30 happens twice; the first is 01:30 EDT = 05:30 UTC.
    expect(iso(fullPullSlotToday(at('2026-11-01T15:00:00Z'), newYork, '01:30'))).toBe(
      '2026-11-01T05:30:00.000Z',
    )
  })

  it('refuses a malformed time or an unknown zone', () => {
    expect(() => fullPullSlotToday(at('2026-10-10T08:00:00Z'), SOFIA, '24:00')).toThrow(RangeError)
    expect(() => fullPullSlotToday(at('2026-10-10T08:00:00Z'), 'Not/AZone', '12:00')).toThrow(
      RangeError,
    )
  })
})

describe('dueSyncs: the change check', () => {
  const now = at('2026-10-10T09:05:00.300Z')
  const due = (state: SyncScheduleState, patch: Partial<ScheduleSettings> = {}, when = now) =>
    dueSyncs(when, SOFIA, settings(patch), state).incremental

  it('is due the first time (no state)', () => {
    expect(due({})).toBe(true)
  })

  it('is due once the interval has passed since the last one, counted in whole minutes', () => {
    // Defaults: every 5 minutes. A tick fires a moment after the minute starts, so two ticks
    // 5 minutes apart are 5 minutes +- a few milliseconds apart: that must still be 5.
    expect(due({ last_incremental_queued_at: '2026-10-10T09:00:00.900Z' })).toBe(true)
    expect(due({ last_incremental_queued_at: '2026-10-10T09:00:59.999Z' })).toBe(true)
    expect(due({ last_incremental_queued_at: '2026-10-10T09:01:00.000Z' })).toBe(false)
    expect(due({ last_incremental_queued_at: '2026-10-10T09:04:59.000Z' })).toBe(false)
    expect(due({ last_incremental_queued_at: '2026-10-10T09:05:00.000Z' })).toBe(false)
  })

  it('counts from the later of the last success and the last time a tick queued one', () => {
    const old = '2026-10-10T08:00:00Z'
    const recent = '2026-10-10T09:02:00Z'
    expect(due({ last_incremental_at: old, last_incremental_queued_at: recent })).toBe(false)
    expect(due({ last_incremental_at: recent, last_incremental_queued_at: old })).toBe(false)
    expect(due({ last_incremental_at: old })).toBe(true)
    // A failed run left no last_incremental_at, but the tick that queued it did: no retry storm.
    expect(due({ last_incremental_queued_at: '2026-10-10T09:04:00Z' })).toBe(false)
  })

  it.each([1, 5, 10, 15, 30] as const)('every %i minute(s)', (minutes) => {
    const last = '2026-10-10T09:00:00Z'
    const state = { last_incremental_queued_at: last }
    const base = at(last).getTime()
    for (const elapsed of [0, 1, 4, 5, 9, 10, 14, 15, 29, 30, 31]) {
      expect(
        due(state, { incremental_minutes: minutes }, new Date(base + elapsed * 60_000 + 200)),
        `${elapsed} min after`,
      ).toBe(elapsed >= minutes)
    }
  })

  it('is never due when switched off', () => {
    expect(due({}, { incremental_enabled: false })).toBe(false)
    expect(
      due({ last_incremental_at: '2026-01-01T00:00:00Z' }, { incremental_enabled: false }),
    ).toBe(false)
  })

  it('ignores a last run that cannot be read, or that lies further ahead than one interval', () => {
    expect(due({ last_incremental_at: 'not a date' })).toBe(true)
    // The clock was moved back: a "last run" an hour from now must not stall the check for an hour.
    expect(due({ last_incremental_at: '2026-10-10T10:05:00Z' })).toBe(true)
    // A last run a minute ahead (skew between two workers) just waits.
    expect(due({ last_incremental_queued_at: '2026-10-10T09:06:00Z' })).toBe(false)
  })

  it('is plain elapsed time across both daylight saving changes', () => {
    // 2026-03-29, Sofia: 00:59 UTC is 02:59 EET and 01:01 UTC is 04:01 EEST: two minutes apart.
    const before = { last_incremental_queued_at: '2026-03-29T00:59:00Z' }
    expect(due(before, { incremental_minutes: 1 }, at('2026-03-29T01:00:10Z'))).toBe(true)
    expect(due(before, { incremental_minutes: 5 }, at('2026-03-29T01:03:10Z'))).toBe(false)
    expect(due(before, { incremental_minutes: 5 }, at('2026-03-29T01:04:10Z'))).toBe(true)
    // 2026-10-25: 00:59 UTC is 03:59 EEST and 01:01 UTC is 03:01 EET (the clock reads earlier).
    const autumn = { last_incremental_queued_at: '2026-10-25T00:59:00Z' }
    expect(due(autumn, { incremental_minutes: 1 }, at('2026-10-25T01:00:10Z'))).toBe(true)
    expect(due(autumn, { incremental_minutes: 5 }, at('2026-10-25T01:03:10Z'))).toBe(false)
    expect(due(autumn, { incremental_minutes: 5 }, at('2026-10-25T01:04:10Z'))).toBe(true)
  })
})

describe('dueSyncs: the full pull', () => {
  // Noon in Sofia in October is 09:00 UTC.
  const slot = '2026-10-10T09:00:00.000Z'
  const due = (now: string, state: SyncScheduleState = {}, patch: Partial<ScheduleSettings> = {}) =>
    dueSyncs(at(now), SOFIA, settings(patch), state)

  it('is not due before today’s time, and due from that minute on', () => {
    expect(due('2026-10-10T08:59:59Z').fullPull).toBe(false)
    const result = due('2026-10-10T09:00:00Z')
    expect(result.fullPull).toBe(true)
    expect(iso(result.fullPullSlot)).toBe(slot)
    expect(due('2026-10-10T17:30:00Z').fullPull).toBe(true)
  })

  it('names no slot while nothing is due', () => {
    expect(due('2026-10-10T08:00:00Z').fullPullSlot).toBeNull()
  })

  it('is done for the day once a full pull ran or was queued since the slot', () => {
    expect(due('2026-10-10T09:01:00Z', { last_full_pull_slot: slot }).fullPull).toBe(false)
    expect(
      due('2026-10-10T09:01:00Z', { last_full_pull_at: '2026-10-10T09:00:20Z' }).fullPull,
    ).toBe(false)
    // A pull a person started with "Sync now" after the time counts too.
    expect(
      due('2026-10-10T15:00:00Z', { last_full_pull_at: '2026-10-10T13:00:00Z' }).fullPull,
    ).toBe(false)
  })

  it('is due when the last full pull is from before the slot', () => {
    expect(
      due('2026-10-10T09:01:00Z', { last_full_pull_at: '2026-10-09T09:00:20Z' }).fullPull,
    ).toBe(true)
    // A "Sync now" at 08:00 does not stand in for the noon pull.
    expect(
      due('2026-10-10T09:01:00Z', { last_full_pull_at: '2026-10-10T05:00:00Z' }).fullPull,
    ).toBe(true)
    expect(
      due('2026-10-10T09:01:00Z', { last_full_pull_slot: '2026-10-09T09:00:00Z' }).fullPull,
    ).toBe(true)
  })

  it('a pull that was queued but did not finish is not asked for again the same day', () => {
    // last_full_pull_at only moves after a complete pull; the slot is what the tick recorded.
    const state = { last_full_pull_at: '2026-10-09T09:00:20Z', last_full_pull_slot: slot }
    expect(due('2026-10-10T09:01:00Z', state).fullPull).toBe(false)
    expect(due('2026-10-10T20:00:00Z', state).fullPull).toBe(false)
    // The next day's slot is a new one.
    expect(due('2026-10-11T09:00:00Z', state).fullPull).toBe(true)
  })

  it('is never due when switched off', () => {
    expect(due('2026-10-10T12:00:00Z', {}, { full_pull_enabled: false }).fullPull).toBe(false)
  })

  it('follows a changed time: later today waits, earlier today is done if the pull already ran', () => {
    const ran = { last_full_pull_slot: slot }
    // Moved to 15:00 (12:00 UTC): due again at 15:00, once.
    expect(due('2026-10-10T11:59:00Z', ran, { full_pull_time: '15:00' }).fullPull).toBe(false)
    expect(due('2026-10-10T12:00:00Z', ran, { full_pull_time: '15:00' }).fullPull).toBe(true)
    // Moved to 11:00 (08:00 UTC), before the slot that already ran: nothing more today.
    expect(due('2026-10-10T10:00:00Z', ran, { full_pull_time: '11:00' }).fullPull).toBe(false)
    // Moved to 11:00 but nothing ran today: it is past, so it is due now.
    expect(due('2026-10-10T10:00:00Z', {}, { full_pull_time: '11:00' }).fullPull).toBe(true)
  })

  describe('midnight edges', () => {
    it('00:00: the minute after local midnight is due, the minute before is the old day', () => {
      const midnight = { full_pull_time: '00:00' }
      // Local midnight on 10 Oct is 21:00 UTC on 9 Oct (EEST). Yesterday's slot was recorded.
      const yesterday = { last_full_pull_slot: '2026-10-08T21:00:00Z' }
      expect(due('2026-10-09T20:59:30Z', yesterday, midnight).fullPull).toBe(false)
      const result = due('2026-10-09T21:00:30Z', yesterday, midnight)
      expect(result.fullPull).toBe(true)
      expect(iso(result.fullPullSlot)).toBe('2026-10-09T21:00:00.000Z')
    })

    it('23:59: due in its own minute, and the next day’s slot is not early', () => {
      const late = { full_pull_time: '23:59' }
      expect(due('2026-10-10T20:58:59Z', {}, late).fullPull).toBe(false)
      const result = due('2026-10-10T20:59:00Z', {}, late)
      expect(result.fullPull).toBe(true)
      expect(iso(result.fullPullSlot)).toBe('2026-10-10T20:59:00.000Z')
      // 00:00:30 on 11 Oct is a new local day: today's slot (23:59 on the 11th) is far away.
      const done = { last_full_pull_slot: '2026-10-10T20:59:00Z' }
      expect(due('2026-10-10T21:00:30Z', done, late).fullPull).toBe(false)
    })
  })

  describe('daylight saving days', () => {
    it('spring: runs once, at the shifted time, on the 23-hour day', () => {
      const inGap = { full_pull_time: '03:30' } // does not exist on 2026-03-29
      expect(due('2026-03-29T01:29:00Z', {}, inGap).fullPull).toBe(false)
      const result = due('2026-03-29T01:30:00Z', {}, inGap)
      expect(result.fullPull).toBe(true)
      expect(iso(result.fullPullSlot)).toBe('2026-03-29T01:30:00.000Z')
      // Recorded, it is not asked for again that day.
      const state = { last_full_pull_slot: '2026-03-29T01:30:00Z' }
      expect(due('2026-03-29T05:00:00Z', state, inGap).fullPull).toBe(false)
      expect(due('2026-03-29T21:30:00Z', state, inGap).fullPull).toBe(false)
      // The day after is a normal day: 03:30 EEST is 00:30 UTC.
      expect(due('2026-03-30T00:30:00Z', state, inGap).fullPull).toBe(true)
    })

    it('autumn: runs once on the 25-hour day, in the first of the two repeated hours', () => {
      const repeated = { full_pull_time: '03:30' } // 03:30 EEST (00:30 UTC) and 03:30 EET (01:30 UTC)
      expect(due('2026-10-25T00:29:00Z', {}, repeated).fullPull).toBe(false)
      const first = due('2026-10-25T00:30:00Z', {}, repeated)
      expect(first.fullPull).toBe(true)
      expect(iso(first.fullPullSlot)).toBe('2026-10-25T00:30:00.000Z')
      // An hour later the clock reads 03:30 again: still the same local day, still done.
      const state = { last_full_pull_slot: '2026-10-25T00:30:00Z' }
      expect(due('2026-10-25T01:30:00Z', state, repeated).fullPull).toBe(false)
      expect(due('2026-10-25T10:00:00Z', state, repeated).fullPull).toBe(false)
      // The next day, 03:30 EET is 01:30 UTC.
      expect(due('2026-10-26T01:30:00Z', state, repeated).fullPull).toBe(true)
    })

    it('the default noon pull stays at 12:00 local on both change days', () => {
      expect(iso(due('2026-03-29T09:00:00Z').fullPullSlot)).toBe('2026-03-29T09:00:00.000Z')
      expect(due('2026-03-29T08:59:00Z').fullPull).toBe(false)
      expect(iso(due('2026-10-25T10:00:00Z').fullPullSlot)).toBe('2026-10-25T10:00:00.000Z')
      expect(due('2026-10-25T09:59:00Z').fullPull).toBe(false)
    })
  })
})

describe('nextSyncRuns', () => {
  const now = at('2026-10-10T09:07:20Z') // 12:07:20 in Sofia
  const next = (state: SyncScheduleState = {}, patch: Partial<ScheduleSettings> = {}, when = now) =>
    nextSyncRuns(when, SOFIA, settings(patch), state)

  it('says "at the next tick" for what is due now', () => {
    const result = next()
    expect(iso(result.incremental)).toBe('2026-10-10T09:08:00.000Z')
    expect(iso(result.fullPull)).toBe('2026-10-10T09:08:00.000Z') // today's 12:00 passed, none ran
  })

  it('counts the change check from the last attempt', () => {
    expect(iso(next({ last_incremental_queued_at: '2026-10-10T09:05:00Z' }).incremental)).toBe(
      '2026-10-10T09:10:00.000Z',
    )
    expect(
      iso(
        next({ last_incremental_queued_at: '2026-10-10T09:05:00Z' }, { incremental_minutes: 15 })
          .incremental,
      ),
    ).toBe('2026-10-10T09:20:00.000Z')
    // Overdue: the next tick, not a time in the past.
    expect(iso(next({ last_incremental_queued_at: '2026-10-10T08:00:00Z' }).incremental)).toBe(
      '2026-10-10T09:08:00.000Z',
    )
  })

  it('the full pull: today’s time while it is ahead, tomorrow’s once today’s is done', () => {
    expect(iso(next({}, {}, at('2026-10-10T05:00:00Z')).fullPull)).toBe('2026-10-10T09:00:00.000Z')
    expect(iso(next({ last_full_pull_slot: '2026-10-10T09:00:00Z' }).fullPull)).toBe(
      '2026-10-11T09:00:00.000Z',
    )
  })

  it('the full pull tomorrow is at the right local time across the autumn change', () => {
    const state = { last_full_pull_slot: '2026-10-24T09:00:00Z' }
    // Noon on the 25th is on winter time: 10:00 UTC.
    expect(iso(next(state, {}, at('2026-10-24T10:00:00Z')).fullPull)).toBe(
      '2026-10-25T10:00:00.000Z',
    )
    // And across the spring change: noon on the 29th is on summer time.
    const spring = { last_full_pull_slot: '2026-03-28T10:00:00Z' }
    expect(iso(next(spring, {}, at('2026-03-28T11:00:00Z')).fullPull)).toBe(
      '2026-03-29T09:00:00.000Z',
    )
  })

  it('has nothing for what is switched off', () => {
    const result = next({}, { incremental_enabled: false, full_pull_enabled: false })
    expect(result).toEqual({ incremental: null, fullPull: null })
    expect(next({}, { full_pull_enabled: false }).incremental).not.toBeNull()
    expect(next({}, { incremental_enabled: false }).fullPull).not.toBeNull()
  })

  it('agrees with dueSyncs: the time it names is the first minute that is due', () => {
    const state = { last_incremental_queued_at: '2026-10-10T09:05:00Z' }
    const named = next(state).incremental
    if (named === null) throw new Error('expected a time')
    const minuteBefore = new Date(named.getTime() - 60_000)
    expect(dueSyncs(minuteBefore, SOFIA, settings(), state).incremental).toBe(false)
    expect(dueSyncs(named, SOFIA, settings(), state).incremental).toBe(true)
  })
})
