import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  choosePay,
  freeLines,
  NO_TIP,
  offersPay,
  PAY_ENDS,
  payBlock,
  paymentIsFinal,
  payScreen,
  payStartCommand,
  pickWhole,
  reconcilePicks,
  sameAmountAgo,
  TIP_PERCENTS,
  togglePick,
} from './paying'
import {
  EMPTY_SERVICE_STATE,
  GuestCommandSchema,
  PAYMENT_STATES,
  type PayingView,
  type PaymentView,
  type TableBillView,
} from './services'
import { stringsFor } from './strings'

const bn = (n: number) => `bn_${String(n).padStart(22, '0')}`
const uuid = '00000000-0000-4000-8000-000000000001'

function bill(
  lines: readonly { id: number; amountMinor: number; beingPaid?: boolean; quantity?: string }[],
  options: { complete?: boolean; partBeingPaid?: boolean } = {},
): TableBillView {
  return {
    readAgoSeconds: 3,
    complete: options.complete ?? true,
    currency: 'EUR',
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    paidMinor: 0,
    owedMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    parts: [
      {
        id: 'bill-1',
        beingPaid: options.partBeingPaid ?? false,
        totalMinor: 0,
        paidMinor: 0,
        lines: lines.map((line) => ({
          id: bn(line.id),
          name: { en_US: `Item ${line.id}` },
          quantity: line.quantity ?? '1',
          amountMinor: line.amountMinor,
          beingPaid: line.beingPaid ?? false,
        })),
      },
    ],
  }
}

const PAYING: PayingView = {
  state: 'on',
  minCardMinor: 50,
  processor: 'Stripe',
  electronicReceipt: false,
  recent: null,
}

function payment(changes: Partial<PaymentView>): PaymentView {
  return {
    id: 'py_1',
    number: 'K7Q4M',
    state: 'awaiting_guest',
    reason: null,
    currency: 'EUR',
    amountMinor: 2750,
    tipMinor: 250,
    lines: [],
    form: { confirmSeconds: 120 },
    ...changes,
  }
}

describe('choosing what to pay (#45, D127)', () => {
  const b = bill([
    { id: 1, amountMinor: 1250 },
    { id: 2, amountMinor: 1000 },
    { id: 3, amountMinor: 900, beingPaid: true },
  ])

  it('starts with nothing ticked and nothing preselected, and lines in a payment are not free', () => {
    expect(freeLines(b).map((line) => line.id)).toEqual([bn(1), bn(2)])
    const totals = choosePay(new Map(), NO_TIP)
    expect(totals).toMatchObject({ itemsMinor: 0, tipMinor: 0, totalMinor: 0 })
    expect(payBlock(PAYING, b, new Map(), NO_TIP)).toBe('nothing_picked')
  })

  it('ticks and unticks a line, never a line being paid', () => {
    const one = togglePick(new Map(), b, bn(1))
    expect([...one.keys()]).toEqual([bn(1)])
    expect(togglePick(one, b, bn(1)).size).toBe(0)
    expect(togglePick(new Map(), b, bn(3)).size).toBe(0)
  })

  it('"The whole bill" ticks every free line, and again clears them', () => {
    const all = pickWhole(new Map(), b)
    expect([...all.keys()]).toEqual([bn(1), bn(2)])
    expect(pickWhole(all, b).size).toBe(0)
  })

  it('rounds the 5, 10 and 15 % presets half-up on the ticked lines', () => {
    const picks = pickWhole(new Map(), bill([{ id: 1, amountMinor: 2450 }]))
    const totals = choosePay(picks, NO_TIP)
    expect(totals.presets).toEqual([
      { percent: 5, tipMinor: 123 },
      { percent: 10, tipMinor: 245 },
      { percent: 15, tipMinor: 368 },
    ])
    expect(choosePay(picks, { kind: 'percent', percent: 15 })).toMatchObject({
      tipMinor: 368,
      totalMinor: 2818,
    })
    expect(choosePay(picks, { kind: 'other', minor: 100 })).toMatchObject({ totalMinor: 2550 })
  })

  it('adds a tip that is a whole number of minor units (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.constantFrom(...TIP_PERCENTS),
        (amount, percent) => {
          const picks = pickWhole(new Map(), bill([{ id: 1, amountMinor: amount }]))
          const totals = choosePay(picks, { kind: 'percent', percent })
          expect(Number.isSafeInteger(totals.tipMinor)).toBe(true)
          expect(totals.totalMinor).toBe(amount + totals.tipMinor)
          // half-up: twice the tip is within one unit of the exact tenth of the percent
          expect(Math.abs(totals.tipMinor * 100 - amount * percent)).toBeLessThanOrEqual(50)
        },
      ),
    )
  })

  it('greys Pay with its reason: paused, not up to date, nothing ticked, below the smallest, tip too big', () => {
    const picks = pickWhole(new Map(), b)
    expect(payBlock({ ...PAYING, state: 'paused' }, b, picks, NO_TIP)).toBe('cards_paused')
    expect(
      payBlock(PAYING, bill([{ id: 1, amountMinor: 500 }], { complete: false }), picks, NO_TIP),
    ).toBe('not_up_to_date')
    const tiny = bill([{ id: 1, amountMinor: 30 }])
    expect(payBlock(PAYING, tiny, pickWhole(new Map(), tiny), NO_TIP)).toBe('below_minimum')
    // The smallest payment is measured on what is held: the lines plus the tip.
    expect(payBlock(PAYING, tiny, pickWhole(new Map(), tiny), { kind: 'other', minor: 20 })).toBe(
      null,
    )
    expect(payBlock(PAYING, b, picks, { kind: 'other', minor: 999_999 })).toBe('tip_too_big')
    expect(payBlock(PAYING, b, picks, NO_TIP)).toBe(null)
  })

  it("keeps the ticks across a friend's new round and clears only a line that changed or went", () => {
    const picks = pickWhole(new Map(), b)
    const friendAdded = bill([
      { id: 1, amountMinor: 1250 },
      { id: 2, amountMinor: 1000 },
      { id: 4, amountMinor: 700 },
    ])
    expect([...reconcilePicks(picks, friendAdded).keys()]).toEqual([bn(1), bn(2)])
    const changed = bill([
      { id: 1, amountMinor: 1250 },
      { id: 2, amountMinor: 1100 },
    ])
    expect([...reconcilePicks(picks, changed).keys()]).toEqual([bn(1)])
    const gone = bill([{ id: 2, amountMinor: 1000 }])
    expect([...reconcilePicks(picks, gone).keys()]).toEqual([bn(2)])
    const nowPaid = bill([
      { id: 1, amountMinor: 1250, beingPaid: true },
      { id: 2, amountMinor: 1000 },
    ])
    expect([...reconcilePicks(picks, nowPaid).keys()]).toEqual([bn(2)])
  })

  it('builds a pay.start the host accepts: each line as the phone saw it, one kind of tip', () => {
    const picks = pickWhole(new Map(), b)
    const preset = payStartCommand(
      uuid,
      picks,
      { kind: 'percent', percent: 10 },
      choosePay(picks, { kind: 'percent', percent: 10 }),
    )
    expect(GuestCommandSchema.safeParse(preset).success).toBe(true)
    expect(preset).toMatchObject({ tipPercent: 10, tipMinor: null })
    expect(preset.seen).toEqual([
      { lineId: bn(1), quantity: '1', amountMinor: 1250 },
      { lineId: bn(2), quantity: '1', amountMinor: 1000 },
    ])
    const amount: Parameters<typeof payStartCommand>[2] = { kind: 'other', minor: 150 }
    const other = payStartCommand(uuid, picks, amount, choosePay(picks, amount))
    expect(GuestCommandSchema.safeParse(other).success).toBe(true)
    expect(other).toMatchObject({ tipPercent: null, tipMinor: 150 })
    const none = payStartCommand(uuid, picks, NO_TIP, choosePay(picks, NO_TIP))
    expect(none).toMatchObject({ tipPercent: null, tipMinor: null })
  })

  it('offers Pay only with a bill, paying on or paused and no payment of this phone', () => {
    const base = { ...EMPTY_SERVICE_STATE, tableBill: b, paying: PAYING }
    expect(offersPay(base)).toBe(true)
    expect(offersPay({ ...base, paying: { ...PAYING, state: 'paused' } })).toBe(true)
    expect(offersPay({ ...base, paying: { ...PAYING, state: 'off' } })).toBe(false)
    expect(offersPay({ ...base, tableBill: null })).toBe(false)
    expect(offersPay({ ...base, payment: payment({}) })).toBe(false)
    expect(offersPay(EMPTY_SERVICE_STATE)).toBe(false)
  })
})

describe("the payment's screens (#110, D127)", () => {
  it('draws one waiting state for everything between the hold and the capture', () => {
    for (const state of [
      'held',
      'queued',
      'isolated',
      'entered',
      'checked',
      'closed',
      'cancelling',
    ] as const) {
      expect(payScreen(payment({ state })), state).toEqual({ kind: 'waiting' })
    }
  })

  it('says paid only for captured', () => {
    for (const state of PAYMENT_STATES) {
      expect(payScreen(payment({ state })).kind === 'paid', state).toBe(state === 'captured')
    }
  })

  it('shows the card form only while it awaits the guest and the form is ready', () => {
    expect(payScreen(payment({ state: 'requested', form: null }))).toEqual({ kind: 'preparing' })
    expect(payScreen(payment({ state: 'priced', form: null }))).toEqual({ kind: 'preparing' })
    expect(payScreen(payment({ state: 'awaiting_guest', form: null }))).toEqual({
      kind: 'preparing',
    })
    expect(payScreen(payment({ state: 'awaiting_guest' }))).toEqual({ kind: 'card' })
  })

  it('shows the venue-is-checking screen for unconfirmed, stranded and capture_failed', () => {
    for (const state of ['unconfirmed', 'stranded', 'capture_failed'] as const) {
      expect(payScreen(payment({ state })), state).toEqual({ kind: 'checking' })
    }
  })

  it('words each release reason, offering Pay again where the guide does', () => {
    const ended = (reason: string | null) => payScreen(payment({ state: 'released', reason }))
    expect(ended('busy')).toEqual({ kind: 'ended', end: 'busy', again: true })
    expect(ended('check_failed')).toEqual({ kind: 'ended', end: 'check_failed', again: true })
    expect(ended('bill_changed')).toEqual({ kind: 'ended', end: 'check_failed', again: true })
    expect(ended('expired')).toEqual({ kind: 'ended', end: 'expired', again: true })
    expect(ended('paying_paused')).toEqual({ kind: 'ended', end: 'paying_paused', again: false })
    expect(ended('isolate_refused')).toEqual({
      kind: 'ended',
      end: 'isolate_refused',
      again: false,
    })
    expect(ended('not_on_till')).toEqual({ kind: 'ended', end: 'no_receipt', again: false })
    expect(ended('cancelled')).toEqual({ kind: 'ended', end: 'cancelled', again: false })
    // A reason the guide has no words for is worded calmly, never as a step of the till.
    expect(ended('item_unavailable')).toEqual({ kind: 'ended', end: 'other', again: false })
    expect(ended(null)).toEqual({ kind: 'ended', end: 'other', again: false })
  })

  it('stops polling a payment at its end, and not before', () => {
    const finals = PAYMENT_STATES.filter((state) => paymentIsFinal(payment({ state })))
    expect(finals).toEqual(['captured', 'released', 'unconfirmed', 'stranded', 'capture_failed'])
  })
})

describe('"Same amount as 4 minutes ago. Pay again?"', () => {
  it('names the minutes for the same amount within 15 minutes, else nothing', () => {
    expect(sameAmountAgo({ amountMinor: 2750, agoSeconds: 240 }, 2750)).toBe(4)
    expect(sameAmountAgo({ amountMinor: 2750, agoSeconds: 10 }, 2750)).toBe(1)
    expect(sameAmountAgo({ amountMinor: 2750, agoSeconds: 15 * 60 }, 2750)).toBeNull()
    expect(sameAmountAgo({ amountMinor: 2750, agoSeconds: 60 }, 2751)).toBeNull()
    expect(sameAmountAgo(null, 2750)).toBeNull()
  })
})

describe("the guest words of the bill and paying (the guide's table, 10-28)", () => {
  it('has Bulgarian and English for each end, the amounts and the counted words', () => {
    for (const locale of ['bg_BG', 'en_US'] as const) {
      const words = stringsFor(locale).services.paying
      expect(Object.keys(words.ended).sort()).toEqual([...PAY_ENDS].sort())
      for (const end of PAY_ENDS) expect(words.ended[end].trim(), end).not.toBe('')
      expect(words.payX('27,50 EUR')).toContain('27,50 EUR')
      expect(words.updated(7)).toContain('7')
      expect(words.sameQuestion(4)).toContain('4')
      expect(words.legalProcessor('Stripe', 'Club X')).toMatch(/Stripe.*Club X/)
      expect(words.belowMinimum('0,50 EUR')).toContain('0,50 EUR')
    }
  })

  it('words the pay refusals as the guide has them', () => {
    const en = stringsFor('en_US').services.refusals
    expect(en.paying_not_offered).toBe('Ask your waiter to pay.')
    expect(en.being_paid).toBe('Someone is already paying for this line.')
    expect(en.bill_changed).toBe('Your bill changed since you opened it.')
    expect(en.ask_waiter_to_split).toBe('Ask your waiter to split this bill.')
    expect(en.too_late).toBe('Too late to cancel: the payment is being processed.')
    const bg = stringsFor('bg_BG').services.refusals
    expect(bg.paying_paused).toBe('Плащането с карта е спряно в момента. Попитайте сервитьора.')
    expect(bg.unknown_payment).toBe('Не намираме това плащане. Попитайте сервитьора.')
  })

  it('never says receipt-like words on the paid screen ("бон", "фискален" are the venue\'s, Н-18 чл. 7а)', () => {
    for (const locale of ['bg_BG', 'en_US'] as const) {
      const words = stringsFor(locale).services.paying
      for (const text of [words.paid, words.paidNumber, words.paidReceipt]) {
        expect(text.toLowerCase()).not.toMatch(/фискал|fiscal|\bбон\b/)
      }
    }
  })
})
