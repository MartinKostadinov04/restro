import { describe, expect, it } from 'vitest'

import { detectAllergenOption, readDetailOptions } from './allergens'

describe('readDetailOptions and detectAllergenOption', () => {
  const payload = [
    {
      group_name: 'Основна',
      group_id: 1,
      details: {
        k102: { detail_name: 'Алергени', type: 'text' },
        k101: { detail_name: 'Годност в дни', type: 'text' },
      },
    },
    { group_name: 'Other', group_id: 2, details: { k200: { detail_name: ' allergens ' } } },
  ]

  it('lists every characteristic by name, ordered by key', () => {
    expect(readDetailOptions(payload)).toEqual([
      { key: 'k101', name: 'Годност в дни' },
      { key: 'k102', name: 'Алергени' },
      { key: 'k200', name: 'allergens' },
    ])
  })

  it('detects "Алергени" or "Allergens" in any case, the lowest key first', () => {
    expect(detectAllergenOption(readDetailOptions(payload))).toEqual({
      key: 'k102',
      name: 'Алергени',
    })
    expect(detectAllergenOption([{ key: 'k1', name: 'ALLERGENS' }])).toEqual({
      key: 'k1',
      name: 'ALLERGENS',
    })
  })

  it('finds none when nothing is named like that', () => {
    expect(detectAllergenOption([{ key: 'k1', name: 'Грамаж' }])).toBeNull()
    expect(detectAllergenOption([])).toBeNull()
  })

  it('reads nothing from a payload of another shape', () => {
    expect(readDetailOptions(null)).toEqual([])
    expect(readDetailOptions({ details: {} })).toEqual([])
    expect(readDetailOptions([{ details: 'x' }, null, { details: [1] }])).toEqual([])
  })
})
