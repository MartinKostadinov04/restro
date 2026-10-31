// Pay first at Send (#258, D113): the words of a pay-first line, the Send's pay-first part with its
// tip and amounts, and D127's single-step Call a waiter. Pure functions every face shares.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  callIsSingleStep,
  type PayFirstLine,
  payFirstStateOf,
  payFirstWords,
  planPayFirst,
} from './pay-first'
import { choosePay, NO_TIP, type Picks } from './paying'
import { stringsFor } from './strings'

const line = (amountMinor: number, qty = 1): PayFirstLine => ({
  itemId: 'nd_00000000000000000000aa',
  optionIds: [],
  qty,
  note: '',
  amountMinor,
})

describe('what a pay-first line says', () => {
  it('is "Not ordered until paid" where the phone pays, and "Order this from your waiter" where it can not', () => {
    const en = stringsFor('en_US').services
    const bg = stringsFor('bg_BG').services
    expect(payFirstWords('on', en)).toBe('Not ordered until paid')
    expect(payFirstWords('paused', en)).toBe('Order this from your waiter')
    expect(payFirstWords('off', en)).toBe('Order this from your waiter')
    expect(payFirstWords('on', bg)).toBe('Не е поръчано, докато не се плати')
  })

  it('reads an absent state as off', () => {
    expect(payFirstStateOf(undefined)).toBe('off')
    expect(payFirstStateOf(null)).toBe('off')
    expect(payFirstStateOf({})).toBe('off')
    expect(payFirstStateOf({ payFirst: 'on' })).toBe('on')
    expect(payFirstStateOf({ payFirst: 'paused' })).toBe('paused')
  })

  it('words "Send and pay" with the amount in both languages', () => {
    expect(stringsFor('en_US').services.sendAndPay('24.00 EUR')).toBe('Send and pay 24.00 EUR')
    expect(stringsFor('bg_BG').services.sendAndPay('24,00 EUR')).toBe('Изпрати и плати 24,00 EUR')
  })
})

describe('the Send’s pay-first part', () => {
  it('is null with no pay-first lines', () => {
    expect(planPayFirst([], NO_TIP, true)).toBeNull()
  })

  it('names every line as the phone saw it, and starts with no tip', () => {
    const plan = planPayFirst([line(1000, 2), line(550)], NO_TIP, true)
    expect(plan?.part).toEqual({
      lines: [
        { itemId: 'nd_00000000000000000000aa', optionIds: [], qty: 2, note: '' },
        { itemId: 'nd_00000000000000000000aa', optionIds: [], qty: 1, note: '' },
      ],
      tipMinor: null,
      tipPercent: null,
    })
    expect(plan?.totals).toMatchObject({ itemsMinor: 1550, tipMinor: 0, totalMinor: 1550 })
  })

  it('sends a preset as its percent and an amount as the amount, never both', () => {
    const preset = planPayFirst([line(1000)], { kind: 'percent', percent: 15 }, true)
    expect(preset?.part).toMatchObject({ tipPercent: 15, tipMinor: null })
    expect(preset?.totals).toMatchObject({ tipMinor: 150, totalMinor: 1150, tipValid: true })
    const other = planPayFirst([line(1000)], { kind: 'other', minor: 250 }, true)
    expect(other?.part).toMatchObject({ tipPercent: null, tipMinor: 250 })
    expect(other?.totals.totalMinor).toBe(1250)
    const zero = planPayFirst([line(1000)], { kind: 'other', minor: 0 }, true)
    expect(zero?.part).toMatchObject({ tipPercent: null, tipMinor: null })
  })

  it('rounds a preset half-up, through the money module', () => {
    // 5 % of 10.10 is 0.505: half-up to 0.51.
    expect(planPayFirst([line(1010)], { kind: 'percent', percent: 5 }, true)?.totals.tipMinor).toBe(
      51,
    )
  })

  it('carries no tip where the till can not record one, whatever was chosen before', () => {
    const plan = planPayFirst([line(1000)], { kind: 'percent', percent: 10 }, false)
    expect(plan?.part).toMatchObject({ tipPercent: null, tipMinor: null })
    expect(plan?.totals).toMatchObject({ tipMinor: 0, totalMinor: 1000 })
    const amount = planPayFirst([line(1000)], { kind: 'other', minor: 500 }, false)
    expect(amount?.part).toMatchObject({ tipPercent: null, tipMinor: null })
  })

  it('marks a tip over the lines invalid, as Pay does', () => {
    expect(planPayFirst([line(1000)], { kind: 'other', minor: 1001 }, true)?.totals.tipValid).toBe(
      false,
    )
    expect(planPayFirst([line(1000)], { kind: 'other', minor: 1000 }, true)?.totals.tipValid).toBe(
      true,
    )
  })

  it('works out the same sums as Pay for the same amounts (one place for the tip)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 8 }),
        fc.constantFrom(
          NO_TIP,
          { kind: 'percent', percent: 5 } as const,
          { kind: 'percent', percent: 10 } as const,
          { kind: 'percent', percent: 15 } as const,
        ),
        (amounts, tip) => {
          const picks: Picks = new Map(
            amounts.map((amountMinor, index) => [
              `l${index}`,
              { lineId: `l${index}`, quantity: '1', amountMinor },
            ]),
          )
          const viaPay = choosePay(picks, tip, true)
          const viaSend = planPayFirst(
            amounts.map((amount) => line(amount)),
            tip,
            true,
          )
          expect(viaSend?.totals).toEqual(viaPay)
        },
      ),
    )
  })
})

describe('the single-step Call a waiter (D127)', () => {
  it('is true for the waiter alone, as the kinds stand', () => {
    expect(callIsSingleStep({ kinds: ['waiter'] })).toBe(true)
    expect(callIsSingleStep({ kinds: ['waiter', 'ice'] })).toBe(false)
    expect(callIsSingleStep({ kinds: ['ice'] })).toBe(false)
    expect(callIsSingleStep({ kinds: [] })).toBe(false)
    expect(callIsSingleStep(null)).toBe(false)
    expect(callIsSingleStep(undefined)).toBe(false)
  })
})
