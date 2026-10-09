import { describe, expect, it } from 'vitest'

import { makeTestView } from './test-view'
import {
  canMoveSection,
  childIdsOf,
  depthOf,
  descendantsOf,
  flattenSections,
  heightOf,
  moveTargets,
} from './tree'

describe('the section tree', () => {
  const { view, ids } = makeTestView()

  it('knows depth, height, children and descendants', () => {
    expect(depthOf(view, ids.cocktails)).toBe(1)
    expect(depthOf(view, ids.classics)).toBe(2)
    expect(depthOf(view, ids.stirred)).toBe(3)
    expect(heightOf(view, ids.cocktails)).toBe(2)
    expect(heightOf(view, ids.beer)).toBe(0)
    expect(childIdsOf(view, null)).toEqual([ids.cocktails, ids.beer])
    expect(childIdsOf(view, ids.cocktails)).toEqual([ids.classics])
    expect([...descendantsOf(view, ids.cocktails)].sort()).toEqual(
      [ids.classics, ids.stirred].sort(),
    )
  })

  it('lists the sections depth first, with their depth', () => {
    expect(flattenSections(view)).toEqual([
      { id: ids.cocktails, depth: 1 },
      { id: ids.classics, depth: 2 },
      { id: ids.stirred, depth: 3 },
      { id: ids.beer, depth: 1 },
    ])
  })

  it('allows a move that fits and refuses the ones that do not', () => {
    // Beer (no sub-sections) can go anywhere above depth 3.
    expect(canMoveSection(view, ids.beer, ids.cocktails)).toBe(true)
    expect(canMoveSection(view, ids.beer, ids.classics)).toBe(true)
    // ...but not under a depth-3 section (it would be at depth 4).
    expect(canMoveSection(view, ids.beer, ids.stirred)).toBe(false)
    // Cocktails holds two more levels: under Beer it would reach depth 4.
    expect(canMoveSection(view, ids.cocktails, ids.beer)).toBe(false)
    // Not into itself or its own sections.
    expect(canMoveSection(view, ids.cocktails, ids.cocktails)).toBe(false)
    expect(canMoveSection(view, ids.cocktails, ids.stirred)).toBe(false)
    // Classics (one level inside) can move to the top, or under Beer (depth 2 + 1 = 3).
    expect(canMoveSection(view, ids.classics, null)).toBe(true)
    expect(canMoveSection(view, ids.classics, ids.beer)).toBe(true)
    // A section that does not exist, or a parent that does not.
    expect(canMoveSection(view, ids.water, null)).toBe(false)
    expect(canMoveSection(view, ids.beer, ids.water)).toBe(false)
  })

  it('offers only legal places in "Move to", never the current parent', () => {
    expect(moveTargets(view, ids.beer)).toEqual([
      { id: ids.cocktails, depth: 1 },
      { id: ids.classics, depth: 2 },
    ])
    expect(moveTargets(view, ids.classics)).toEqual([
      { id: null, depth: 0 },
      { id: ids.beer, depth: 1 },
    ])
    // Cocktails already sits at the top, and nowhere below fits it.
    expect(moveTargets(view, ids.cocktails)).toEqual([])
  })
})
