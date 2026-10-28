import { describe, expect, it } from 'vitest'

import { payFirstCheck, payFirstStateOf, payFirstTableNote } from './pay-first'

type Connection = Parameters<typeof payFirstStateOf>[1]

const connection = (
  state: 'connected' | 'lost_access' = 'connected',
  on = true,
  providerKind: string | null = 'sim',
) => ({ state, providerKind, readiness: { on } }) as unknown as Connection

const open = { firstItemsOpenBill: true }

describe('whether a table offers pay-first items (#113, #114)', () => {
  it('is off where the POS cannot open a bill that names itself, or paying is off', () => {
    expect(payFirstStateOf({ firstItemsOpenBill: false }, connection(), false)).toBe('off')
    expect(payFirstStateOf(open, connection('connected', false), false)).toBe('off')
    expect(payFirstStateOf(open, connection('connected', true, null), false)).toBe('off')
  })

  it('is paused while the account lost access or ordering is paused, else on', () => {
    expect(payFirstStateOf(open, connection('lost_access'), false)).toBe('paused')
    expect(payFirstStateOf(open, connection(), true)).toBe('paused')
    expect(payFirstStateOf(open, connection(), false)).toBe('on')
  })
})

describe('the pay-first check before the close (#113)', () => {
  const bill = (totalMinor: number, lines = [totalMinor], more = {}) => ({
    bills: 1,
    totalMinor,
    paidMinor: 0,
    lines: lines.map((amountMinor) => ({ amountMinor })),
    ...more,
  })
  const base = { linesMinor: 1_200, tipMinor: 100, partialCapture: true, heldMinor: 1_300 }
  const why = (input: Parameters<typeof payFirstCheck>[0]) => {
    const check = payFirstCheck(input)
    return check.ok ? 'ok' : check.why
  }

  it('closes for the hold when the POS total is the priced lines', () => {
    expect(payFirstCheck({ ...base, bill: bill(1_200, [800, 400]) })).toEqual({
      ok: true,
      amountMinor: 1_300,
      lowered: false,
    })
  })

  it("captures the POS's lower amount, only where the provider captures less", () => {
    expect(payFirstCheck({ ...base, bill: bill(1_000) })).toEqual({
      ok: true,
      amountMinor: 1_100,
      lowered: true,
    })
    expect(why({ ...base, partialCapture: false, bill: bill(1_000) })).toBe('partial_not_supported')
  })

  it('never closes for more than the guest agreed, nor on a bill that is not the round', () => {
    expect(why({ ...base, bill: bill(1_400) })).toBe('pos_higher')
    expect(why({ ...base, bill: null })).toBe('no_bill')
    expect(why({ ...base, bill: bill(1_200, []) })).toBe('no_bill')
    expect(why({ ...base, bill: bill(1_200, [1_200], { bills: 2 }) })).toBe('several_bills')
    expect(why({ ...base, bill: bill(1_200, [1_200], { paidMinor: 200 }) })).toBe('part_paid')
    expect(why({ ...base, bill: bill(1_200, [1_000]) })).toBe('total_changed')
    expect(why({ ...base, heldMinor: 1_299, bill: bill(1_200) })).toBe('hold_lost')
  })
})

describe('the note naming the guest table (#113)', () => {
  it("is worded in the venue's language", () => {
    expect(payFirstTableNote('en', 'Table 7')).toBe('for Table 7')
    expect(payFirstTableNote('bg', 'Маса 7')).toBe('за Маса 7')
  })
})
