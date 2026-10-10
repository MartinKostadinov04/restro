import { describe, expect, it } from 'vitest'

import { type Availability, describeOpening, scheduleStatus } from './schedule'
import { stringsFor } from './strings'

const sofia = (rules: Availability['rules']): Availability => ({
  timezone: 'Europe/Sofia',
  rules,
})

// 2026-10-07 is a Wednesday; Sofia is UTC+3 until 25 October.
const at = (iso: string) => new Date(iso)

const lateNight = sofia([{ days: [5, 6], from: '22:00', to: '04:00' }])

describe('scheduleStatus (R1)', () => {
  it('has no restriction without a schedule or without rules', () => {
    expect(scheduleStatus(null, at('2026-10-07T20:30:00+03:00'))).toEqual({ open: true })
    expect(scheduleStatus(sofia([]), at('2026-10-07T20:30:00+03:00'))).toEqual({ open: true })
  })

  it('is open inside a same-day window and closed at its end', () => {
    const evenings = sofia([{ days: [1, 2, 3, 4, 5, 6, 7], from: '18:00', to: '23:00' }])
    expect(scheduleStatus(evenings, at('2026-10-07T18:00:00+03:00')).open).toBe(true)
    expect(scheduleStatus(evenings, at('2026-10-07T22:59:59+03:00')).open).toBe(true)
    expect(scheduleStatus(evenings, at('2026-10-07T23:00:00+03:00')).open).toBe(false)
  })

  it('counts a window that runs past midnight for the day it starts on', () => {
    // Friday 9 Oct 22:00 to Saturday 04:00, and Saturday 22:00 to Sunday 04:00.
    expect(scheduleStatus(lateNight, at('2026-10-09T22:00:00+03:00')).open).toBe(true)
    expect(scheduleStatus(lateNight, at('2026-10-10T02:00:00+03:00')).open).toBe(true)
    expect(scheduleStatus(lateNight, at('2026-10-10T04:00:00+03:00')).open).toBe(false)
    expect(scheduleStatus(lateNight, at('2026-10-11T02:00:00+03:00')).open).toBe(true)
    // Thursday night into Friday morning is not in the window.
    expect(scheduleStatus(lateNight, at('2026-10-09T02:00:00+03:00')).open).toBe(false)
  })

  it('reads the venue wall clock from an instant given in another offset', () => {
    // 19:30 UTC is 22:30 in Sofia on Friday.
    expect(scheduleStatus(lateNight, at('2026-10-09T19:30:00Z')).open).toBe(true)
    expect(scheduleStatus(lateNight, at('2026-10-09T18:30:00Z')).open).toBe(false)
  })

  it('treats 24:00 as the end of the day', () => {
    const toMidnight = sofia([{ days: [3], from: '20:00', to: '24:00' }])
    expect(scheduleStatus(toMidnight, at('2026-10-07T23:59:00+03:00')).open).toBe(true)
    expect(scheduleStatus(toMidnight, at('2026-10-08T00:00:00+03:00')).open).toBe(false)
  })

  it('finds the next opening: later today, another day, or next week', () => {
    const today = scheduleStatus(
      sofia([{ days: [3], from: '22:00', to: '23:30' }]),
      at('2026-10-07T20:30:00+03:00'),
    )
    expect(today).toMatchObject({ open: false, next: { dayOffset: 0, weekday: 3, from: '22:00' } })

    const friday = scheduleStatus(lateNight, at('2026-10-07T20:30:00+03:00'))
    expect(friday).toMatchObject({ open: false, next: { dayOffset: 2, weekday: 5, from: '22:00' } })

    const nextWeek = scheduleStatus(
      sofia([{ days: [3], from: '10:00', to: '12:00' }]),
      at('2026-10-07T20:30:00+03:00'),
    )
    expect(nextWeek).toMatchObject({ open: false, next: { dayOffset: 7, weekday: 3 } })
  })

  it('takes the earliest of several windows', () => {
    const status = scheduleStatus(
      sofia([
        { days: [5], from: '23:00', to: '02:00' },
        { days: [4], from: '19:00', to: '21:00' },
      ]),
      at('2026-10-07T20:30:00+03:00'),
    )
    expect(status).toMatchObject({ open: false, next: { dayOffset: 1, weekday: 4, from: '19:00' } })
  })
})

describe('describeOpening', () => {
  const next = (dayOffset: number, weekday: number) => ({
    dayOffset,
    weekday,
    from: '18:00',
    order: 0,
  })

  it('says "from 18:00" for later today, in both languages', () => {
    expect(describeOpening(next(0, 3), stringsFor('en_US')).text).toEqual({
      text: 'from 18:00',
      lang: 'en_US',
    })
    expect(describeOpening(next(0, 3), stringsFor('bg_BG')).text.text).toBe('от 18:00')
    expect(describeOpening(next(0, 3), stringsFor('bg_BG')).weekday).toBeNull()
  })

  it('names tomorrow and later days', () => {
    expect(describeOpening(next(1, 4), stringsFor('en_US')).text.text).toBe('tomorrow from 18:00')
    expect(describeOpening(next(2, 5), stringsFor('en_US')).text.text).toBe('Fri from 18:00')
    expect(describeOpening(next(2, 5), stringsFor('bg_BG')).text.text).toBe('пт от 18:00')
    expect(describeOpening(next(2, 5), stringsFor('en_US')).weekday).toBe(5)
  })
})
