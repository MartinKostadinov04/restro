import { describe, expect, it } from 'vitest'

import { canNest, MAX_SECTION_DEPTH, NODE_TYPE_SPECS, NODE_TYPES } from './node-types'

describe('NODE_TYPE_SPECS', () => {
  it("mirrors the doc's node types table", () => {
    expect(NODE_TYPE_SPECS.menu).toEqual({
      cardinality: 'singular',
      allowedParents: [],
      leaf: false,
    })
    expect(NODE_TYPE_SPECS.section.cardinality).toBe('many')
    expect(NODE_TYPE_SPECS.section.allowedParents).toEqual(['menu', 'section'])
    expect(NODE_TYPE_SPECS.item.allowedParents).toEqual([])
    expect(NODE_TYPE_SPECS.modifier_group.allowedParents).toEqual(['item'])
    expect(NODE_TYPE_SPECS.option).toMatchObject({ allowedParents: ['modifier_group'], leaf: true })
    expect(NODE_TYPE_SPECS.special.cardinality).toBe('series')
  })
})

describe('canNest', () => {
  it('allows the structure the doc describes', () => {
    expect(canNest('menu', 'section', 1)).toBe(true)
    expect(canNest('section', 'section', 2)).toBe(true)
    expect(canNest('section', 'section', 3)).toBe(true)
    expect(canNest('item', 'modifier_group', 1)).toBe(true)
    expect(canNest('modifier_group', 'option', 1)).toBe(true)
    expect(canNest('menu', 'special', 1)).toBe(true)
  })

  it('never puts a series under a many (so no Special under a Section)', () => {
    expect(canNest('section', 'special', 2)).toBe(false)
    for (const parent of NODE_TYPES) {
      if (NODE_TYPE_SPECS[parent].cardinality === 'many') {
        expect(canNest(parent, 'special', 2), parent).toBe(false)
      }
    }
  })

  it('never lets an item contain an item, and never makes an item a child', () => {
    expect(canNest('item', 'item', 1)).toBe(false)
    for (const parent of NODE_TYPES) expect(canNest(parent, 'item', 1), parent).toBe(false)
  })

  it('keeps items out of sections (they appear through placements)', () => {
    expect(canNest('section', 'item', 2)).toBe(false)
  })

  it('treats an option as a leaf', () => {
    for (const child of NODE_TYPES) expect(canNest('option', child, 2), child).toBe(false)
  })

  it('nests sections at most 3 deep and rejects depth 4', () => {
    expect(MAX_SECTION_DEPTH).toBe(3)
    expect(canNest('section', 'section', 4)).toBe(false)
    expect(canNest('menu', 'section', 2)).toBe(false)
    expect(canNest('section', 'section', 1)).toBe(false)
  })

  it('keeps the menu at the root and rejects invalid depths', () => {
    for (const parent of NODE_TYPES) expect(canNest(parent, 'menu', 1), parent).toBe(false)
    expect(canNest('menu', 'section', 0)).toBe(false)
    expect(canNest('menu', 'section', 1.5)).toBe(false)
  })

  it('rejects parents the doc does not allow', () => {
    expect(canNest('menu', 'modifier_group', 1)).toBe(false)
    expect(canNest('section', 'option', 2)).toBe(false)
    expect(canNest('item', 'section', 1)).toBe(false)
  })
})
