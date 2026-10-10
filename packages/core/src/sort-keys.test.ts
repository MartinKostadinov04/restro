import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  compareSortKeys,
  isSortKey,
  SortKeySchema,
  sortKeyBetween,
  sortKeysBetween,
} from './sort-keys'

describe('sortKeyBetween', () => {
  it('starts at a0 and extends at both ends', () => {
    const first = sortKeyBetween(null, null)
    expect(first).toBe('a0')
    const after = sortKeyBetween(first, null)
    const before = sortKeyBetween(null, first)
    expect(before < first && first < after).toBe(true)
  })

  it('refuses keys out of order, equal keys and invalid keys', () => {
    expect(() => sortKeyBetween('a2', 'a1')).toThrow(RangeError)
    expect(() => sortKeyBetween('a1', 'a1')).toThrow(RangeError)
    expect(() => sortKeyBetween('a10', null)).toThrow(RangeError)
    expect(() => sortKeyBetween(null, 'not a key')).toThrow(RangeError)
  })

  it('is strictly between a and b for random ordered pairs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 60 }),
        fc.nat(),
        fc.nat(),
        (inserts, i, j) => {
          // Build a random ordered list of keys by inserting at random positions.
          const keys: string[] = []
          for (const position of inserts) {
            const at = position % (keys.length + 1)
            keys.splice(at, 0, sortKeyBetween(keys[at - 1] ?? null, keys[at] ?? null))
          }
          for (let k = 1; k < keys.length; k++) {
            expect((keys[k - 1] as string) < (keys[k] as string)).toBe(true)
          }
          const low = Math.min(i % keys.length, j % keys.length)
          const high = Math.max(i % keys.length, j % keys.length)
          if (low === high) return
          const a = keys[low] as string
          const b = keys[high] as string
          const between = sortKeyBetween(a, b)
          expect(a < between && between < b).toBe(true)
          expect(isSortKey(between)).toBe(true)
        },
      ),
      { numRuns: 500 },
    )
  })
})

describe('sortKeysBetween', () => {
  it('returns n ascending keys inside the bounds', () => {
    const keys = sortKeysBetween('a0', 'a1', 5)
    expect(keys).toHaveLength(5)
    expect([...keys].sort(compareSortKeys)).toEqual(keys)
    expect(keys.every((key) => 'a0' < key && key < 'a1')).toBe(true)
    expect(sortKeysBetween(null, null, 3)).toEqual(['a0', 'a1', 'a2'])
    expect(sortKeysBetween(null, null, 0)).toEqual([])
  })

  it('refuses a negative or fractional n', () => {
    expect(() => sortKeysBetween(null, null, -1)).toThrow(RangeError)
    expect(() => sortKeysBetween(null, null, 1.5)).toThrow(RangeError)
  })
})

describe('isSortKey and compareSortKeys', () => {
  it('accepts library keys and rejects others', () => {
    for (const key of ['a0', 'a1V', 'Zz', 'b00']) expect(isSortKey(key), key).toBe(true)
    for (const key of ['', 'a', 'a10', 'a1V0', '0a', 'a-1', 42]) {
      expect(isSortKey(key), String(key)).toBe(false)
    }
    expect(SortKeySchema.safeParse('a0').success).toBe(true)
    expect(SortKeySchema.safeParse('a').success).toBe(false)
  })

  it('orders by code unit, not by locale (uppercase sorts before lowercase)', () => {
    const keys = ['a0', 'Zz', 'a0V', 'a1']
    expect([...keys].sort(compareSortKeys)).toEqual(['Zz', 'a0', 'a0V', 'a1'])
  })
})
