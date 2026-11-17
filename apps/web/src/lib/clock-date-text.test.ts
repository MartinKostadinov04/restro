import { describe, expect, it } from 'vitest'

import {
  formatDateText,
  parseDateText,
  parseTimeText,
  stepDate,
  stepTime,
} from './clock-date-text'

describe('parseTimeText', () => {
  it.each([
    ['22:00', '22:00'],
    ['2:30', '02:30'],
    ['0530', '05:30'],
    ['530', '05:30'],
    ['05.30', '05:30'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
  ])('reads %s as %s', (text, expected) => {
    expect(parseTimeText(text, false)).toBe(expected)
  })

  it.each(['25:00', '24:00', '12:60', '9', '', 'ab', '12:5', '123456', '22:00 PM'])(
    'refuses %s',
    (text) => {
      expect(parseTimeText(text, true)).toBeNull()
    },
  )

  it('takes an hour alone only when final', () => {
    expect(parseTimeText('22', false)).toBeNull()
    expect(parseTimeText('22', true)).toBe('22:00')
    expect(parseTimeText('7', true)).toBe('07:00')
  })
})

describe('stepTime', () => {
  it('wraps around midnight both ways', () => {
    expect(stepTime('23:55', 10)).toBe('00:05')
    expect(stepTime('00:05', -10)).toBe('23:55')
    expect(stepTime('', 5)).toBe('00:05')
  })
})

describe('parseDateText', () => {
  it.each([
    ['10.11.2026', '2026-11-10'],
    ['1.2.2026', '2026-02-01'],
    ['10/11/2026', '2026-11-10'],
    ['10112026', '2026-11-10'],
    ['2026-11-10', '2026-11-10'],
    ['29.02.2028', '2028-02-29'],
  ])('reads %s as %s', (text, expected) => {
    expect(parseDateText(text)).toBe(expected)
  })

  it.each(['31.02.2026', '29.02.2027', '32.01.2026', '10.13.2026', '10.11.26', '', 'x'])(
    'refuses %s',
    (text) => {
      expect(parseDateText(text)).toBeNull()
    },
  )
})

describe('formatDateText and stepDate', () => {
  it('shows day.month.year', () => {
    expect(formatDateText('2026-11-10')).toBe('10.11.2026')
    expect(formatDateText('')).toBe('')
  })
  it('steps across month and year ends', () => {
    expect(stepDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(stepDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})
