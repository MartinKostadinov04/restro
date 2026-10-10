import { sortKeysBetween } from '@restro/core'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { type KeyedId, keyAtEnd, planKeys } from './plan'

const list = (...keys: string[]): KeyedId[] => keys.map((key, i) => ({ id: `id${i}`, key }))

/** The ids in order after writing the plan's keys over the list. */
function orderAfter(others: readonly KeyedId[], plan: readonly KeyedId[]): string[] {
  const keyOf = new Map(others.map(({ id, key }) => [id, key]))
  for (const { id, key } of plan) keyOf.set(id, key)
  return [...keyOf.entries()].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id]) => id)
}

describe('planKeys', () => {
  it('gives the first item of an empty list the first key', () => {
    expect(planKeys([], 'x', 0)).toEqual([{ id: 'x', key: 'a0' }])
  })

  it('writes one key between the neighbours', () => {
    const others = list('a0', 'a1', 'a2')
    for (const index of [0, 1, 2, 3]) {
      const plan = planKeys(others, 'x', index)
      expect(plan).toHaveLength(1)
      const expected = [...others.map((o) => o.id)]
      expected.splice(index, 0, 'x')
      expect(orderAfter(others, plan)).toEqual(expected)
    }
  })

  it('clamps an index past the end', () => {
    const others = list('a0', 'a1')
    expect(orderAfter(others, planKeys(others, 'x', 99))).toEqual(['id0', 'id1', 'x'])
    expect(orderAfter(others, planKeys(others, 'x', -3))).toEqual(['x', 'id0', 'id1'])
  })

  it('re-spaces the whole list when the neighbours have the same key', () => {
    const others = list('a0', 'a1', 'a1', 'a2')
    const plan = planKeys(others, 'x', 2)
    expect(plan.map((entry) => entry.id)).toEqual(['id0', 'id1', 'x', 'id2', 'id3'])
    const keys = plan.map((entry) => entry.key)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('re-spaces when the neighbours are out of order', () => {
    const others = list('a5', 'a1')
    expect(planKeys(others, 'x', 1).map((entry) => entry.id)).toEqual(['id0', 'x', 'id1'])
  })

  it('puts the moved item exactly where asked, for any list and index (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.nat(60), (size, index) => {
        const keys = sortKeysBetween(null, null, size)
        const others = keys.map((key, i) => ({ id: `id${i}`, key }))
        const plan = planKeys(others, 'x', index)
        const at = Math.min(index, size)
        const expected = others.map((o) => o.id)
        expected.splice(at, 0, 'x')
        expect(orderAfter(others, plan)).toEqual(expected)
        // A normal move writes one row.
        expect(plan).toHaveLength(1)
      }),
    )
  })

  it('still puts it right when a clash forces a re-spacing (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.nat(30), (size, index) => {
        const keys = sortKeysBetween(null, null, size)
        // The first two items share a key.
        const others = keys.map((key, i) => ({
          id: `id${i}`,
          key: i === 1 ? (keys[0] ?? key) : key,
        }))
        const plan = planKeys(others, 'x', Math.min(index, size))
        const ids = plan.length === 1 ? orderAfter(others, plan) : plan.map((entry) => entry.id)
        const expected = others.map((o) => o.id)
        expected.splice(Math.min(index, size), 0, 'x')
        // Either a single key landed in the right place, or the whole list was re-spaced in order.
        expect(ids).toEqual(expected)
      }),
    )
  })
})

describe('keyAtEnd', () => {
  it('is after every key, and the first key for an empty list', () => {
    expect(keyAtEnd([])).toBe('a0')
    const keys = ['a0', 'a1', 'Zz', 'a5']
    const end = keyAtEnd(list(...keys))
    for (const key of keys) expect(end > key).toBe(true)
  })
})
