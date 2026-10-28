import { describe, expect, it } from 'vitest'

import { type AreaId, type BarId, newId, type TableId } from './ids'
import {
  DEFAULT_PAY_FIRST_SETTINGS,
  itemPaymentMode,
  type PayFirstSettings,
  PayFirstSettingsSchema,
  payFirstApplies,
  readPayFirstSettings,
} from './pay-first-settings'

const tableId = newId('tb') as TableId
const barId = newId('br') as BarId
const areaId = newId('ar') as AreaId
const place = { tableId, barId, areaId }

describe('pay-first settings (#113)', () => {
  it('defaults to every item on the bill and passes its own schema', () => {
    expect(PayFirstSettingsSchema.parse(DEFAULT_PAY_FIRST_SETTINGS)).toEqual(
      DEFAULT_PAY_FIRST_SETTINGS,
    )
    expect(readPayFirstSettings({})).toEqual(DEFAULT_PAY_FIRST_SETTINGS)
    expect(readPayFirstSettings({ payFirst: { itemMode: 'later' } })).toEqual(
      DEFAULT_PAY_FIRST_SETTINGS,
    )
  })

  it("takes an item's own mode over the venue's default", () => {
    const venue: PayFirstSettings = { ...DEFAULT_PAY_FIRST_SETTINGS, itemMode: 'pay_first' }
    expect(itemPaymentMode(null, venue)).toBe('pay_first')
    expect(itemPaymentMode(undefined, venue)).toBe('pay_first')
    expect(itemPaymentMode('on_bill', venue)).toBe('on_bill')
    expect(itemPaymentMode('pay_first', DEFAULT_PAY_FIRST_SETTINGS)).toBe('pay_first')
  })

  it('lets the most specific level win: table, then bar, then hall, then venue', () => {
    const venueOff: PayFirstSettings = { ...DEFAULT_PAY_FIRST_SETTINGS, applies: false }
    expect(payFirstApplies(venueOff, place)).toBe(false)
    const hallOn = { ...venueOff, groups: { [areaId]: true } }
    expect(payFirstApplies(hallOn, place)).toBe(true)
    const barOff = { ...venueOff, groups: { [areaId]: true, [barId]: false } }
    expect(payFirstApplies(barOff, place)).toBe(false)
    expect(payFirstApplies(barOff, { ...place, barId: null })).toBe(true)
    const tableOn = { ...barOff, tables: { [tableId]: true } }
    expect(payFirstApplies(tableOn, place)).toBe(true)
  })

  it('names only bars, halls and tables', () => {
    const bad = { ...DEFAULT_PAY_FIRST_SETTINGS, groups: { [tableId]: true } }
    expect(PayFirstSettingsSchema.safeParse(bad).success).toBe(false)
  })
})
