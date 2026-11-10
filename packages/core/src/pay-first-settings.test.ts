import { describe, expect, it } from 'vitest'

import { type AreaId, type BarId, newId, type TableId } from './ids'
import {
  DEFAULT_PAY_FIRST_SETTINGS,
  itemPaymentMode,
  type PayFirstSettings,
  PayFirstSettingsSchema,
  type PayRule,
  payFirstApplies,
  payFirstAppliesAt,
  payFirstRuleApplies,
  payFirstRuleAt,
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

describe("the reservation's own level (#334, D135)", () => {
  // The order the ticket states, most specific first. A level "says nothing" where it is unset:
  // the table and the bar and the hall have no row, the party carries no rule.
  const order = ['table', 'reservation', 'bar', 'area', 'venue'] as const

  /** What each level says, or `undefined` for a level that says nothing. */
  interface Says {
    readonly table?: boolean
    readonly reservation?: boolean
    readonly bar?: boolean
    readonly area?: boolean
    readonly venue: boolean
  }

  function settingsOf(says: Says): PayFirstSettings {
    return {
      ...DEFAULT_PAY_FIRST_SETTINGS,
      applies: says.venue,
      groups: {
        ...(says.area === undefined ? {} : { [areaId]: says.area }),
        ...(says.bar === undefined ? {} : { [barId]: says.bar }),
      },
      tables: says.table === undefined ? {} : { [tableId]: says.table },
    }
  }

  /** The reading the order above demands: the first level that says anything decides. */
  function expected(says: Says): { applies: boolean; level: (typeof order)[number] } {
    for (const level of order) {
      const said = says[level]
      if (said !== undefined) return { applies: said, level }
    }
    throw new Error('the venue always says something')
  }

  it('reads table, then reservation, then bar, then hall, then the house', () => {
    const maybe = [undefined, true, false] as const
    let seen = 0
    for (const table of maybe) {
      for (const reservation of maybe) {
        for (const bar of maybe) {
          for (const area of maybe) {
            for (const venue of [true, false] as const) {
              const says: Says = { table, reservation, bar, area, venue }
              const rule: PayRule | null =
                reservation === undefined ? null : reservation ? 'pay_first' : 'on_bill'
              expect(payFirstRuleAt(settingsOf(says), place, rule)).toEqual(expected(says))
              expect(payFirstRuleApplies(settingsOf(says), place, rule)).toBe(
                expected(says).applies,
              )
              seen += 1
            }
          }
        }
      }
    }
    expect(seen).toBe(3 * 3 * 3 * 3 * 2)
  })

  it("leaves a table with no bar to its hall, the party's rule still above it", () => {
    const noBar = { ...place, barId: null }
    const settings = settingsOf({ bar: true, area: false, venue: true })
    expect(payFirstRuleAt(settings, noBar, null)).toEqual({ applies: false, level: 'area' })
    expect(payFirstRuleAt(settings, noBar, 'pay_first')).toEqual({
      applies: true,
      level: 'reservation',
    })
    // And with the bar in the picture, the bar is below the party all the same.
    expect(payFirstRuleAt(settings, place, 'on_bill')).toEqual({
      applies: false,
      level: 'reservation',
    })
  })

  it("says nothing new where no party carries a rule: the venue's own reading, level and all", () => {
    for (const settings of [
      settingsOf({ venue: true }),
      settingsOf({ area: true, venue: false }),
      settingsOf({ bar: false, area: true, venue: false }),
      settingsOf({ table: true, venue: false }),
    ]) {
      expect(payFirstRuleAt(settings, place, null)).toEqual(payFirstAppliesAt(settings, place))
    }
  })

  it("a table's own choice beats the party's, even saying the same thing", () => {
    const tableOff = settingsOf({ table: false, venue: false })
    expect(payFirstRuleAt(tableOff, place, 'pay_first')).toEqual({ applies: false, level: 'table' })
    const tableOn = settingsOf({ table: true, venue: true })
    expect(payFirstRuleAt(tableOn, place, 'pay_first')).toEqual({ applies: true, level: 'table' })
    expect(payFirstRuleAt(tableOn, place, 'on_bill')).toEqual({ applies: true, level: 'table' })
  })
})
