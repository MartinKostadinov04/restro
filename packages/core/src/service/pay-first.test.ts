import { describe, expect, it } from 'vitest'

import { projectGuestState } from './guest'
import {
  billIsRound,
  payFirstCheck,
  payFirstStateOf,
  payFirstTableNote,
  payingStateOf,
} from './pay-first'
import type { TableStateRead } from './read'

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

describe('whether paying on the bill is offered (#114)', () => {
  it('is off until the venue is connected and every check passes, with no provider none', () => {
    expect(payingStateOf(connection('connected', false), false)).toBe('off')
    expect(payingStateOf(connection('connected', true, null), false)).toBe('off')
  })

  it('is paused while the account lost access or paying is paused, else on', () => {
    expect(payingStateOf(connection('lost_access'), false)).toBe('paused')
    expect(payingStateOf(connection('lost_access', false), false)).toBe('paused')
    expect(payingStateOf(connection(), true)).toBe('paused')
    expect(payingStateOf(connection(), false)).toBe('on')
  })
})

describe('the pay-first check before the close (#113)', () => {
  // The round: a gin (article 2002) for 8 EUR and a tonic (2003) for 4 EUR.
  const round = [
    { item: '2002', quantity: '1', amountMinor: 800 },
    { item: '2003', quantity: '1', amountMinor: 400 },
  ]
  type Line = { item: string | null; quantity?: string; amountMinor: number }
  const bill = (lines: Line[], more = {}) => ({
    bills: 1,
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    paidMinor: 0,
    lines: lines.map((line) => ({ quantity: '1', ...line })),
    ...more,
  })
  const asEntered: Line[] = [
    { item: '2002', amountMinor: 800 },
    { item: '2003', amountMinor: 400 },
  ]
  const base = { round, tipMinor: 100, partialCapture: true, heldMinor: 1_300 }
  const why = (input: Parameters<typeof payFirstCheck>[0]) => {
    const check = payFirstCheck(input)
    return check.ok ? 'ok' : check.why
  }

  it("closes for the hold when the bill is the round's lines at their prices", () => {
    expect(payFirstCheck({ ...base, bill: bill(asEntered) })).toEqual({
      ok: true,
      amountMinor: 1_300,
      lowered: false,
    })
  })

  it("captures the POS's lower amount (a line dropped or lowered), only where the provider captures less", () => {
    expect(payFirstCheck({ ...base, bill: bill([{ item: '2002', amountMinor: 800 }]) })).toEqual({
      ok: true,
      amountMinor: 900,
      lowered: true,
    })
    expect(
      payFirstCheck({
        ...base,
        bill: bill([
          { item: '2002', amountMinor: 700 },
          { item: '2003', amountMinor: 400 },
        ]),
      }),
    ).toMatchObject({ ok: true, amountMinor: 1_200 })
    expect(
      why({ ...base, partialCapture: false, bill: bill([{ item: '2002', amountMinor: 800 }]) }),
    ).toBe('partial_not_supported')
  })

  it("never takes someone else's bill for the round", () => {
    // A waiter's bill on the payment table: another item, or the same item for more, or more of it.
    expect(why({ ...base, bill: bill([{ item: '3001', amountMinor: 500 }]) })).toBe('not_the_round')
    expect(why({ ...base, bill: bill([...asEntered, { item: '2002', amountMinor: 800 }]) })).toBe(
      'not_the_round',
    )
    expect(why({ ...base, bill: bill([{ item: '2002', amountMinor: 900 }]) })).toBe('not_the_round')
    expect(why({ ...base, bill: bill([{ item: '2002', quantity: '2', amountMinor: 800 }]) })).toBe(
      'not_the_round',
    )
    expect(why({ ...base, bill: bill([{ item: null, amountMinor: 100 }]) })).toBe('not_the_round')
    expect(why({ ...base, round: null, bill: bill(asEntered) })).toBe('round_unknown')
  })

  it('never closes a bill that is not one whole, unpaid bill, nor without the hold', () => {
    expect(why({ ...base, bill: null })).toBe('no_bill')
    expect(why({ ...base, bill: bill([]) })).toBe('no_bill')
    expect(why({ ...base, bill: bill(asEntered, { bills: 2 }) })).toBe('several_bills')
    expect(why({ ...base, bill: bill(asEntered, { paidMinor: 200 }) })).toBe('part_paid')
    expect(why({ ...base, bill: bill(asEntered, { totalMinor: 1_100 }) })).toBe('total_changed')
    expect(why({ ...base, heldMinor: 1_299, bill: bill(asEntered) })).toBe('hold_lost')
  })
})

describe('telling the round from another bill (#113)', () => {
  const round = [{ item: '2002', quantity: '2', amountMinor: 2_200 }]

  it('allows fewer of a line and a lower amount, never more or another item', () => {
    expect(billIsRound(round, [{ item: '2002', quantity: '2.000', amountMinor: 2_200 }])).toBe(true)
    expect(billIsRound(round, [{ item: '2002', quantity: '1', amountMinor: 1_100 }])).toBe(true)
    expect(billIsRound(round, [{ item: '2002', quantity: '3', amountMinor: 2_200 }])).toBe(false)
    expect(billIsRound(round, [{ item: '2003', quantity: '2', amountMinor: 2_200 }])).toBe(false)
    expect(billIsRound(round, [])).toBe(false)
  })
})

describe('the note naming the guest table (#113)', () => {
  it("is worded in the venue's language", () => {
    expect(payFirstTableNote('en', 'Table 7')).toBe('for Table 7')
    expect(payFirstTableNote('bg', 'Маса 7')).toBe('за Маса 7')
  })
})

describe("what the phone hears of a pay-first round's sent order (#113)", () => {
  const now = new Date('2026-10-28T22:00:00Z')
  const sent = (kind: string, state: string) => ({
    id: `so_${kind}_${state}`,
    kind,
    state,
    reason: null,
    reference: 'A1',
    createdAt: now,
    settledAt: null,
    lines: [{ itemId: 'nd_gin', optionIds: [], qty: 2 }],
  })
  const states = ['waiting', 'not_sent', 'unconfirmed', 'added']
  const read = {
    unchanged: false,
    version: 1,
    now,
    nextChangeAt: null,
    table: { label: 'Table 7' },
    sitting: { id: 'st_1', openedAt: now },
    order: null,
    sentOrders: [
      ...states.map((state) => sent('pay_first', state)),
      ...states.map((state) => sent('on_bill', state)),
    ],
    waiterCall: null,
    leases: [],
    pauses: [],
    notesAndOptions: true,
    payFirst: { state: 'on', items: new Set(['nd_gin']) },
    paying: { state: 'on', provider: 'sim-pay', minCardMinor: 50 },
    reading: null,
    bill: null,
    backendValues: new Set(),
  } as unknown as TableStateRead

  it('is Added once on the bill; waiting, Not sent or unconfirmed, only its payment speaks', () => {
    expect(projectGuestState(read, 'order').sentOrders.map((one) => one.id)).toEqual([
      'so_pay_first_added',
      'so_on_bill_waiting',
      'so_on_bill_not_sent',
      'so_on_bill_unconfirmed',
      'so_on_bill_added',
    ])
  })

  it('tells a round on the POS whose payment ended "No receipt" apart: ordered, not paid (#114)', () => {
    const withUnpaid = {
      ...read,
      sentOrders: [
        { ...sent('pay_first', 'added'), unpaid: true },
        { ...sent('on_bill', 'added'), unpaid: false },
      ],
    } as unknown as TableStateRead
    const shown = projectGuestState(withUnpaid, 'order').sentOrders
    expect(shown.map((one) => one.unpaid)).toEqual([true, undefined])
  })
})
