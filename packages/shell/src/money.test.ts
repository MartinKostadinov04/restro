import { describe, expect, it } from 'vitest'

import { parseMinor, viewMinor } from './money'

describe('parseMinor (a guest-typed amount)', () => {
  it('reads whole amounts and amounts with one or two decimals, with a comma or a dot', () => {
    expect(parseMinor('3')).toBe(300)
    expect(parseMinor('2,5')).toBe(250)
    expect(parseMinor('2,50')).toBe(250)
    expect(parseMinor('2.50')).toBe(250)
    expect(parseMinor('0.05')).toBe(5)
    expect(parseMinor('0')).toBe(0)
    expect(parseMinor('  12,34  ')).toBe(1234)
    expect(parseMinor('007')).toBe(700)
  })

  it('refuses anything that is not such an amount: no sign, no third decimal, no words', () => {
    for (const bad of [
      '',
      ' ',
      '-1',
      '+1',
      '1,234',
      '1.',
      '.5',
      ',5',
      'abc',
      '1e2',
      '1 2',
      '1,2,3',
      '€5',
      '1234567890',
    ]) {
      expect(parseMinor(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('never goes through a float: 0.07 and 1.15 come out exact', () => {
    expect(parseMinor('0,07')).toBe(7)
    expect(parseMinor('1,15')).toBe(115)
    expect(parseMinor('8,2')).toBe(820)
  })
})

describe('viewMinor', () => {
  it('turns minor units into the amount as shown', () => {
    expect(viewMinor(1250, 'EUR', 'en_US')).toEqual({
      minor: 1250,
      currency: 'EUR',
      text: '€12.50',
    })
    expect(viewMinor(0, 'EUR', 'bg_BG').text).toBe('0,00 €')
  })

  it('refuses a float or a negative amount', () => {
    expect(() => viewMinor(12.5, 'EUR', 'en_US')).toThrow()
    expect(() => viewMinor(-1, 'EUR', 'en_US')).toThrow()
  })
})
