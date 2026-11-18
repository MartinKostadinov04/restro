// Tonight's pay-rule line (walk P6): true only where something is really paid first, never merely
// because the house allows it. Pure; the menu's items come in as one fact.
import { describe, expect, it } from 'vitest'

import type { AreaId, BarId, TableId } from './ids'
import {
  DEFAULT_PAY_FIRST_SETTINGS,
  type PayFirstSettings,
  payFirstLineAt,
} from './pay-first-settings'

const TABLE = 'tb_00000000000000000000A' as TableId
const place = {
  tableId: TABLE,
  barId: null as BarId | null,
  areaId: 'ar_00000000000000000000A' as AreaId,
}
const settings = (over: Partial<PayFirstSettings>): PayFirstSettings => ({
  ...DEFAULT_PAY_FIRST_SETTINGS,
  ...over,
})

describe('payFirstLineAt', () => {
  it('has no line where the venue is on the bill and no item is paid first', () => {
    expect(payFirstLineAt(settings({}), place, null, false).payFirst).toBe(false)
  })

  it('has the line where the venue mode is pay-first', () => {
    expect(payFirstLineAt(settings({ itemMode: 'pay_first' }), place, null, false)).toEqual({
      payFirst: true,
      level: 'venue',
    })
  })

  it('has the line where an orderable item of the menu is pay-first', () => {
    expect(payFirstLineAt(settings({}), place, null, true)).toEqual({
      payFirst: true,
      level: 'venue',
    })
  })

  it('has the line where the table switch says pay-first applies', () => {
    expect(payFirstLineAt(settings({ tables: { [TABLE]: true } }), place, null, false)).toEqual({
      payFirst: true,
      level: 'table',
    })
  })

  it('has the line where the party carries a pay-first rule', () => {
    expect(payFirstLineAt(settings({}), place, 'pay_first', false)).toEqual({
      payFirst: true,
      level: 'reservation',
    })
  })

  it('has no line where the table switch turns pay-first off, items or not', () => {
    const off = settings({ itemMode: 'pay_first', tables: { [TABLE]: false } })
    expect(payFirstLineAt(off, place, null, true).payFirst).toBe(false)
  })
})
