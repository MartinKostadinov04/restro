// A venue's pick of a POS floor (#71): no pick serves everything, a pick serves the union of its
// halls and bars, and a stored value that does not parse means the whole floor.
import { describe, expect, it } from 'vitest'

import { FloorSourceSchema, inFloorSource, readFloorSource, WHOLE_FLOOR } from './floor-source'

const table = (area: string | null, bar: string | null) => ({ area, bar })

describe('inFloorSource', () => {
  it('serves every table when nothing is picked', () => {
    expect(inFloorSource(WHOLE_FLOOR, table('Hall', 'b1'))).toBe(true)
    expect(inFloorSource(WHOLE_FLOOR, table(null, null))).toBe(true)
  })

  it('serves a picked hall, whatever its bar', () => {
    const source = { halls: ['Hall'], bars: null, paymentTables: [] }
    expect(inFloorSource(source, table('Hall', null))).toBe(true)
    expect(inFloorSource(source, table('Hall', 'other'))).toBe(true)
    expect(inFloorSource(source, table('Terrace', 'b1'))).toBe(false)
    expect(inFloorSource(source, table(null, 'b1'))).toBe(false)
  })

  it('serves a picked bar, whatever its hall', () => {
    const source = { halls: null, bars: ['b1'], paymentTables: [] }
    expect(inFloorSource(source, table('Anywhere', 'b1'))).toBe(true)
    expect(inFloorSource(source, table('Hall', 'b2'))).toBe(false)
    expect(inFloorSource(source, table('Hall', null))).toBe(false)
  })

  it('serves the union when both are picked', () => {
    const source = { halls: ['Hall'], bars: ['b9'], paymentTables: [] }
    expect(inFloorSource(source, table('Hall', 'b1'))).toBe(true)
    expect(inFloorSource(source, table('Terrace', 'b9'))).toBe(true)
    expect(inFloorSource(source, table('Terrace', 'b1'))).toBe(false)
  })
})

describe('readFloorSource', () => {
  it('reads a saved pick, and the whole floor where none is saved or the value is not one', () => {
    const saved = { halls: ['Hall'], bars: null, paymentTables: ['P1'] }
    expect(readFloorSource({ floor_source: saved })).toEqual(saved)
    expect(readFloorSource({})).toEqual(WHOLE_FLOOR)
    expect(readFloorSource({ floor_source: { halls: [] } })).toEqual(WHOLE_FLOOR)
    expect(readFloorSource({ floor_source: 'Hall' })).toEqual(WHOLE_FLOOR)
  })

  it('refuses an empty pick and unknown keys', () => {
    expect(FloorSourceSchema.safeParse({ halls: [], bars: null, paymentTables: [] }).success).toBe(
      false,
    )
    expect(
      FloorSourceSchema.safeParse({ halls: null, bars: null, paymentTables: [], extra: 1 }).success,
    ).toBe(false)
  })
})
