import { describe, expect, it } from 'vitest'

import { type AreaId, type BarId, newId, type TableId } from './ids'
import {
  DEFAULT_PAY_FIRST_SETTINGS,
  itemPaymentMode,
  type PayFirstSettings,
  PayFirstSettingsSchema,
  payFirstApplies,
  payFirstAppliesAt,
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

  it('reports which level decided: table, bar, hall or venue', () => {
    const venueOff: PayFirstSettings = { ...DEFAULT_PAY_FIRST_SETTINGS, applies: false }
    expect(payFirstAppliesAt(venueOff, place)).toEqual({ applies: false, level: 'venue' })
    const hallOn = { ...venueOff, groups: { [areaId]: true } }
    expect(payFirstAppliesAt(hallOn, place)).toEqual({ applies: true, level: 'area' })
    // A stored bar value is honoured though no screen sets one; with no bar the hall decides.
    const barOff = { ...hallOn, groups: { [areaId]: true, [barId]: false } }
    expect(payFirstAppliesAt(barOff, place)).toEqual({ applies: false, level: 'bar' })
    expect(payFirstAppliesAt(barOff, { ...place, barId: null })).toEqual({
      applies: true,
      level: 'area',
    })
    // A table's own choice wins even when it says the same as the level above.
    const tableOff = { ...barOff, tables: { [tableId]: false } }
    expect(payFirstAppliesAt(tableOff, place)).toEqual({ applies: false, level: 'table' })
    const tableOn = { ...barOff, tables: { [tableId]: true } }
    expect(payFirstAppliesAt(tableOn, place)).toEqual({ applies: true, level: 'table' })
    for (const settings of [venueOff, hallOn, barOff, tableOff, tableOn]) {
      expect(payFirstApplies(settings, place)).toBe(payFirstAppliesAt(settings, place).applies)
    }
  })

  it('names only bars, halls and tables', () => {
    const bad = { ...DEFAULT_PAY_FIRST_SETTINGS, groups: { [tableId]: true } }
    expect(PayFirstSettingsSchema.safeParse(bad).success).toBe(false)
  })
})
