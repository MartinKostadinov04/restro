import { describe, expect, it } from 'vitest'

import { DEFAULT_ORDERING_SETTINGS, type OrderingSettings } from '../ordering-settings'
import {
  ALERT_RULES,
  CONNECTION_UNSTABLE_KIND,
  ORDER_PACE_KIND,
  ORDER_RATE_KIND,
  ORDER_UNCONFIRMED_KIND,
  PAUSED_KIND,
  ruleOf,
  serviceHoursWindow,
} from './alert-rules'
import { ORDER_RATE_ALERT } from './order-rate'
import { CONNECTION_UNSTABLE_ALERT } from './pauses'
import { ORDER_PACE_ALERT } from './send-guards'
import { ORDER_UNCONFIRMED_ALERT } from './sent-order'

const SOFIA = 'Europe/Sofia'

const friday = { opens: '22:00', lastOrders: '04:00', closes: '05:00' }
const settings: OrderingSettings = {
  ...DEFAULT_ORDERING_SETTINGS,
  serviceHours: { ...DEFAULT_ORDERING_SETTINGS.serviceHours, fri: friday },
}

describe('the kinds other tickets raise', () => {
  it('are the names those tickets write', () => {
    expect(ORDER_UNCONFIRMED_KIND).toBe(ORDER_UNCONFIRMED_ALERT)
    expect(ORDER_RATE_KIND).toBe(ORDER_RATE_ALERT)
    expect(ORDER_PACE_KIND).toBe(ORDER_PACE_ALERT)
    expect(CONNECTION_UNSTABLE_KIND).toBe(CONNECTION_UNSTABLE_ALERT)
  })
})

describe('ruleOf (D120: who is told, how often)', () => {
  it('tells the ticked accounts, the venue group and the Restro team about an Unconfirmed order', () => {
    const rule = ruleOf(ORDER_UNCONFIRMED_KIND, 'venue')
    expect(rule.push).toMatchObject({ firstDelayMs: 10_000, minGapMs: 60_000 })
    expect(rule.push?.reminder).toEqual({ afterMs: 10 * 60_000, max: 1, ownersOnly: false })
    expect(rule.venueTelegram).not.toBeNull()
    expect(rule.team?.minGapMs).toBe(10 * 60_000)
  })

  it('tells a pause once, with "back"; reminds owners once after an hour and the team hourly, 3 at most', () => {
    const rule = ruleOf(PAUSED_KIND, 'venue')
    expect(rule.back).toBe(true)
    expect(rule.closesItself).toBe(true)
    expect(rule.push?.reminder).toEqual({ afterMs: 60 * 60_000, max: 1, ownersOnly: true })
    expect(rule.venueTelegram?.reminder).toBeNull()
    expect(rule.team?.reminder).toEqual({ afterMs: 60 * 60_000, max: 3, ownersOnly: false })
  })

  it("sends the guards' trips to the Restro team only, grouped", () => {
    for (const kind of [ORDER_RATE_KIND, ORDER_PACE_KIND, CONNECTION_UNSTABLE_KIND]) {
      const rule = ruleOf(kind, 'restro')
      expect(rule.push).toBeNull()
      expect(rule.venueTelegram).toBeNull()
      expect(rule.team?.minGapMs).toBe(10 * 60_000)
    }
  })

  it('leaves the stock notice to Tonight', () => {
    const rule = ruleOf('item_out_of_stock', 'venue')
    expect([rule.push, rule.venueTelegram, rule.team]).toEqual([null, null, null])
  })

  it('treats a kind it does not know by its audience', () => {
    expect(ruleOf('something_new', 'restro').team).not.toBeNull()
    expect(ruleOf('something_new', 'restro').push).toBeNull()
    expect(ruleOf('something_new', 'venue').push).not.toBeNull()
  })

  it('closes by answer only the two payment questions a card hold waits on (#162)', () => {
    const byAnswer = Object.entries(ALERT_RULES)
      .filter(([, rule]) => rule.closesByAnswer)
      .map(([kind]) => kind)
    expect(byAnswer.sort()).toEqual(['payment_lines_not_back', 'payment_unconfirmed'])
    expect(ruleOf('something_new', 'venue').closesByAnswer).toBe(false)
    expect(ruleOf(PAUSED_KIND, 'venue').closesByAnswer).toBe(false)
  })

  it('lets only the pre-opening check outside service hours', () => {
    const outside = Object.entries(ALERT_RULES)
      .filter(([, rule]) => rule.outsideServiceHours)
      .map(([kind]) => kind)
    expect(outside).toEqual(['pre_opening_check'])
  })
})

describe('serviceHoursWindow', () => {
  it('opens in the evening and closes past midnight on the same service day', () => {
    const window = serviceHoursWindow(settings, SOFIA, '07:00', new Date('2026-10-23T20:00:00Z'))
    // Friday 2026-10-23, 23:00 local.
    expect(window.date).toBe('2026-10-23')
    expect(window.opensAt?.toISOString()).toBe('2026-10-23T19:00:00.000Z')
    expect(window.closesAt?.toISOString()).toBe('2026-10-24T02:00:00.000Z')
    expect(window.inService).toBe(true)
  })

  it('is still the same service day after midnight', () => {
    const window = serviceHoursWindow(settings, SOFIA, '07:00', new Date('2026-10-24T00:30:00Z'))
    expect(window.date).toBe('2026-10-23')
    expect(window.inService).toBe(true)
  })

  it('is out of service before opening and after closing', () => {
    expect(
      serviceHoursWindow(settings, SOFIA, '07:00', new Date('2026-10-23T15:00:00Z')).inService,
    ).toBe(false)
    expect(
      serviceHoursWindow(settings, SOFIA, '07:00', new Date('2026-10-24T03:00:00Z')).inService,
    ).toBe(false)
  })

  it('has no window on a day the venue is closed', () => {
    const window = serviceHoursWindow(settings, SOFIA, '07:00', new Date('2026-10-21T20:00:00Z'))
    expect(window).toMatchObject({ date: '2026-10-21', opensAt: null, closesAt: null })
    expect(window.inService).toBe(false)
  })
})
