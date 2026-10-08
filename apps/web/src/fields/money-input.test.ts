import { minorToDecimal } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { moneyToInput, parseMoneyInput } from './money-input'

describe('parseMoneyInput (the money editor: major units in, integer minor units out)', () => {
  it.each([
    ['12.5', 1250],
    ['12.50', 1250],
    ['12,50', 1250],
    ['12,5', 1250],
    ['0.05', 5],
    ['0', 0],
    ['7', 700],
    ['  3.20 ', 320],
    ['0.1', 10],
    ['1999.99', 199999],
  ])('reads %j as %d minor units', (text, minor) => {
    expect(parseMoneyInput(text, 'EUR')).toEqual({ amount_minor: minor, currency: 'EUR' })
  })

  it('reads nothing as no value', () => {
    expect(parseMoneyInput('', 'EUR')).toBeUndefined()
    expect(parseMoneyInput('   ', 'EUR')).toBeUndefined()
  })

  it.each(['abc', '12.345', '1,234.50', '1 234', '-1', '+1', '.5', '5.', '1e3', '12.5.0'])(
    'refuses %j instead of rounding or guessing',
    (text) => {
      expect(parseMoneyInput(text, 'EUR')).toBe('invalid')
    },
  )

  it('shows a stored amount as major units with two decimals', () => {
    expect(moneyToInput({ amount_minor: 1250, currency: 'EUR' })).toBe('12.50')
    expect(moneyToInput({ amount_minor: 5, currency: 'EUR' })).toBe('0.05')
    expect(moneyToInput(undefined)).toBe('')
  })

  it('round-trips every amount: minor → text → minor (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (minor) => {
        const text = moneyToInput({ amount_minor: minor, currency: 'EUR' })
        expect(text).toBe(minorToDecimal(minor))
        expect(parseMoneyInput(text, 'EUR')).toEqual({ amount_minor: minor, currency: 'EUR' })
        // The comma spelling means the same.
        expect(parseMoneyInput(text.replace('.', ','), 'EUR')).toEqual({
          amount_minor: minor,
          currency: 'EUR',
        })
      }),
    )
  })
})
