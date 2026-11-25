// Sharing the bill by amount (#544, D160 §3): the rules every face shares. What is checked here is
// what the ticket says — "Split the amount" is offered only where the venue can close one bill with
// several cards, a part is never above what is left nor below the smallest card payment nor leaves
// the others a rest nobody can pay, "The rest" goes to the server as "the rest", and every state of
// the share and of this phone's own part draws exactly one screen, with nothing reading as paid
// before the server says `captured` (D72).

import { describe, expect, it } from 'vitest'

import {
  payingState,
  payingView,
  payment as payScenarioPayment,
  shareHold,
  shareScenarios,
  shareView,
} from '../testing/paying'

import { NO_TIP, payStartCommand } from './paying'
import { PAYMENT_STATES, SHARE_HOLD_STATES, type ShareView } from './services'
import {
  offersShare,
  offersTakeBack,
  SHARE_REST,
  shareBlock,
  shareEndText,
  shareHoldCommand,
  shareMinutesLeft,
  sharePart,
  sharePartText,
  shareProgressText,
  shareScreen,
  shareStartCommand,
  shareTotals,
} from './sharing'
import { stringsFor } from './strings'

const words = stringsFor('en_US').services.paying
const bg = stringsFor('bg_BG').services.paying
const typed = (value: string) => ({ kind: 'amount' as const, typed: value })

describe('offersShare', () => {
  const on = () => payingState({ ordering: { state: 'on', tips: true, sharing: true } })

  it('offers it where the venue can close one bill with several cards', () => {
    expect(offersShare(on())).toBe(true)
  })

  it('never offers it where the POS cannot, or where guests pay before they order', () => {
    expect(offersShare(payingState())).toBe(false)
    expect(
      offersShare(payingState({ ordering: { state: 'on', tips: true, sharing: false } })),
    ).toBe(false)
  })

  it('never offers it without a bill, without paying on, or inside a payment or a share', () => {
    expect(offersShare({ ...on(), tableBill: null })).toBe(false)
    expect(offersShare({ ...on(), paying: payingView({ state: 'paused' }) })).toBe(false)
    expect(offersShare({ ...on(), share: shareView() })).toBe(false)
    expect(offersShare({ ...on(), payment: payScenarioPayment() })).toBe(false)
  })
})

describe('the part the guest takes', () => {
  it('reads what is typed as minor units, spaces and commas included (rule 8)', () => {
    expect(sharePart(typed('40'), shareView())).toEqual({ kind: 'ok', minor: 4_000 })
    expect(sharePart(typed('40,50'), shareView())).toEqual({ kind: 'ok', minor: 4_050 })
    expect(sharePart(typed('1 2,05'), shareView())).toEqual({ kind: 'ok', minor: 1_205 })
  })

  it('says nothing while nothing usable is typed', () => {
    expect(sharePart(typed(''), shareView())).toEqual({ kind: 'empty' })
    expect(sharePart(typed('   '), shareView())).toEqual({ kind: 'empty' })
    expect(sharePart(typed('abc'), shareView())).toEqual({ kind: 'bad' })
    expect(sharePart(typed('0'), shareView())).toEqual({ kind: 'bad' })
    expect(sharePart(typed('-5'), shareView())).toEqual({ kind: 'bad' })
  })

  it('"The rest" is what is left of the shared amount', () => {
    expect(sharePart(SHARE_REST, shareView())).toEqual({ kind: 'ok', minor: 8_150 })
  })

  it('refuses more than is left, less than the smallest card payment, and a rest nobody can pay', () => {
    expect(sharePart(typed('90'), shareView())).toEqual({
      kind: 'problem',
      problem: 'above_share',
    })
    expect(sharePart(typed('0,20'), shareView())).toEqual({
      kind: 'problem',
      problem: 'below_minimum',
    })
    expect(sharePart(typed('81,30'), shareView())).toEqual({
      kind: 'problem',
      problem: 'rest_below_minimum',
    })
  })

  it('lets "The rest" through where the rest is the whole shared amount', () => {
    const fresh = shareView({ heldMinor: 0, claimedMinor: 0, leftMinor: 10_900 })
    expect(sharePart(SHARE_REST, fresh)).toEqual({ kind: 'ok', minor: 10_900 })
  })

  it('words each refusal with the amount it is about', () => {
    expect(sharePartText(words, 'above_share', shareView(), 'en_US')).toBe(
      'Only €81.50 is left to pay.',
    )
    expect(sharePartText(words, 'below_minimum', shareView(), 'en_US')).toBe(
      'The smallest card payment is €0.50.',
    )
    expect(sharePartText(words, 'rest_below_minimum', shareView(), 'en_US')).toBe(
      'That would leave less than €0.50 for the others.',
    )
    expect(sharePartText(bg, 'above_share', shareView(), 'bg_BG')).toContain('Остават само')
  })
})

describe('why Pay is greyed', () => {
  const paying = payingView()

  it('is open once an amount within the limits is typed', () => {
    expect(shareBlock(shareView(), typed('40'), paying, NO_TIP, true)).toBe(null)
    expect(shareBlock(shareView(), SHARE_REST, paying, NO_TIP, true)).toBe(null)
  })

  it('offline comes before everything, and paused cards before the share itself', () => {
    expect(shareBlock(shareView(), typed('40'), paying, NO_TIP, true, true)).toBe('offline')
    expect(
      shareBlock(shareView(), typed('40'), payingView({ state: 'paused' }), NO_TIP, true),
    ).toBe('cards_paused')
  })

  it('says the share is over once it is no longer taking parts', () => {
    expect(shareBlock(shareView({ state: 'held' }), SHARE_REST, paying, NO_TIP, true)).toBe(
      'share_over',
    )
  })

  it('greys Pay with no words while nothing usable is typed, and words every limit', () => {
    expect(shareBlock(shareView(), typed(''), paying, NO_TIP, true)).toBe('no_amount')
    expect(shareBlock(shareView(), typed('x'), paying, NO_TIP, true)).toBe('no_amount')
    expect(shareBlock(shareView(), typed('90'), paying, NO_TIP, true)).toBe('above_share')
    expect(shareBlock(shareView(), typed('0,10'), paying, NO_TIP, true)).toBe('below_minimum')
    expect(shareBlock(shareView(), typed('81,40'), paying, NO_TIP, true)).toBe('rest_below_minimum')
  })

  it('refuses a tip above the part', () => {
    const tip = { kind: 'other' as const, minor: 50_000 }
    expect(shareBlock(shareView(), typed('40'), paying, tip, true)).toBe('tip_too_big')
    // Where the venue records no tip, what was typed for one is not counted at all.
    expect(shareBlock(shareView(), typed('40'), paying, tip, false)).toBe(null)
  })

  it('adds the tip to the part for the hold, and nothing for a part that is refused', () => {
    expect(
      shareTotals(typed('40'), shareView(), { kind: 'percent', percent: 10 }, true),
    ).toMatchObject({ itemsMinor: 4_000, tipMinor: 400, totalMinor: 4_400, tipValid: true })
    expect(shareTotals(typed('90'), shareView(), NO_TIP, true).totalMinor).toBe(0)
  })
})

describe('the commands a face sends', () => {
  it('shares the lines the phone saw, as a Pay would (D111)', () => {
    const picks = new Map([
      [
        'bn_0000000000000000000001',
        { lineId: 'bn_0000000000000000000001', quantity: '1', amountMinor: 2_450 },
      ],
    ])
    const start = payStartCommand('a1', picks, NO_TIP, true)
    expect(shareStartCommand('a2', start)).toEqual({
      kind: 'share.start',
      actionId: 'a2',
      pick: start.pick,
      seen: start.seen,
    })
  })

  it('sends a typed part as its amount and "The rest" as "the rest" (D160 2.11)', () => {
    const share = shareView()
    expect(shareHoldCommand('a1', share, typed('40'), NO_TIP, true)).toEqual({
      kind: 'share.hold',
      actionId: 'a1',
      paymentId: share.id,
      part: { kind: 'amount', minor: 4_000 },
      tipPercent: null,
      tipMinor: null,
    })
    expect(shareHoldCommand('a2', share, SHARE_REST, NO_TIP, true)?.part).toEqual({ kind: 'rest' })
  })

  it('carries the tip the guest chose, and none where the venue records no tip', () => {
    const share = shareView()
    expect(
      shareHoldCommand('a1', share, typed('40'), { kind: 'percent', percent: 10 }, true),
    ).toMatchObject({ tipPercent: 10, tipMinor: null })
    expect(
      shareHoldCommand('a1', share, typed('40'), { kind: 'other', minor: 250 }, true),
    ).toMatchObject({ tipPercent: null, tipMinor: 250 })
    expect(
      shareHoldCommand('a1', share, typed('40'), { kind: 'percent', percent: 10 }, false),
    ).toMatchObject({ tipPercent: null, tipMinor: null })
  })

  it('sends nothing while the part is refused', () => {
    expect(shareHoldCommand('a1', shareView(), typed('90'), NO_TIP, true)).toBe(null)
    expect(shareHoldCommand('a1', shareView(), typed(''), NO_TIP, true)).toBe(null)
  })
})

describe('the screens', () => {
  it('draws the screen the ticket names for every state of the share and of this part', () => {
    for (const scenario of shareScenarios()) {
      const screen = shareScreen(scenario.share)
      expect(screen.kind, scenario.name).toBe(scenario.screen)
      if (scenario.end !== undefined && screen.kind === 'ended') {
        expect(screen.end, scenario.name).toBe(scenario.end)
        expect(screen.again, scenario.name).toBe(scenario.again === true)
      }
    }
  })

  it('covers every state a share and a part can be in', () => {
    const scenarios = shareScenarios()
    for (const state of PAYMENT_STATES) {
      expect(
        scenarios.some((s) => s.share.state === state),
        state,
      ).toBe(true)
    }
    for (const state of SHARE_HOLD_STATES) {
      expect(
        scenarios.some((s) => s.share.mine?.state === state),
        state,
      ).toBe(true)
    }
  })

  it('never draws paid before the server says captured (D72)', () => {
    for (const scenario of shareScenarios()) {
      const paid = scenario.screen === 'paid' || scenario.screen === 'settled'
      const captured =
        scenario.share.mine?.state === 'captured' || scenario.share.state === 'captured'
      expect(paid, scenario.name).toBe(captured)
    }
  })

  it('offers "Take my part back" only until the amount is covered (D160 2.5)', () => {
    for (const scenario of shareScenarios()) {
      expect(offersTakeBack(scenario.share), scenario.name).toBe(scenario.takeBack === true)
    }
  })

  it('says "the bill changed" only for that ending, and nothing was charged for the others', () => {
    expect(shareEndText(words, 'bill_changed')).toBe('The bill changed. Nothing was charged.')
    for (const end of ['expired', 'cancelled', 'withdrawn', 'other'] as const) {
      expect(shareEndText(words, end)).toBe('Nothing was charged.')
    }
  })
})

describe('what the screens say', () => {
  it('counts the minutes left up, and stops once the time is gone', () => {
    const endsAt = '2026-11-25T23:30:00.000Z'
    const at = (iso: string) => shareMinutesLeft(endsAt, Date.parse(iso))
    expect(at('2026-11-25T23:20:00.000Z')).toBe(10)
    expect(at('2026-11-25T23:29:01.000Z')).toBe(1)
    expect(at('2026-11-25T23:30:00.000Z')).toBe(null)
    expect(at('2026-11-25T23:31:00.000Z')).toBe(null)
    expect(shareMinutesLeft(null, Date.now())).toBe(null)
    expect(shareMinutesLeft('not a time', Date.now())).toBe(null)
  })

  it('says what the table has covered of the shared amount, in the guest language', () => {
    expect(shareProgressText(words, shareView(), 'en_US')).toBe(
      '€27.50 of €109.00 paid · €81.50 left',
    )
    // The Bulgarian amount holds a no-break space between the number and the sign.
    const plain = (text: string) => text.replaceAll(' ', ' ')
    expect(plain(shareProgressText(bg, shareView(), 'bg_BG'))).toBe(
      'Платени 27,50 € от 109,00 € · остават 81,50 €',
    )
  })

  it('shows the whole amount as left on a share nobody has taken a part of yet', () => {
    const fresh: ShareView = shareView({
      heldMinor: 0,
      claimedMinor: 0,
      leftMinor: 10_900,
      holds: 0,
      endsAt: null,
      mine: shareHold({ state: 'held', form: null }),
    })
    expect(shareProgressText(words, fresh, 'en_US')).toBe('€0.00 of €109.00 paid · €109.00 left')
    expect(shareMinutesLeft(fresh.endsAt, Date.now())).toBe(null)
  })
})
