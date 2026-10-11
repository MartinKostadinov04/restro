import { describe, expect, it } from 'vitest'

import { NODE_TYPES } from '../node-types'
import {
  CONNECTOR_LABELS,
  connectorLabel,
  INTEGRATION_KINDS,
  isIntegrationKind,
  TILL_LINK_TYPES,
  type TillLinkTypes,
  tillLinkTypeProblem,
} from './index'

describe('connector kinds', () => {
  it('knows each kind, and nothing else', () => {
    for (const kind of INTEGRATION_KINDS) expect(isIntegrationKind(kind)).toBe(true)
    for (const value of ['', 'till', 'manual', 'BARSY', undefined, null, 1]) {
      expect(isIntegrationKind(value), String(value)).toBe(false)
    }
  })

  it('declares link types for every node type, and a label, for every kind', () => {
    for (const kind of INTEGRATION_KINDS) {
      expect(Object.keys(TILL_LINK_TYPES[kind]).sort()).toEqual([...NODE_TYPES].sort())
      expect(connectorLabel(kind)).toBe(CONNECTOR_LABELS[kind])
      expect(connectorLabel(kind).length).toBeGreaterThan(0)
    }
    // The menu and specials never mirror a till object.
    for (const kind of INTEGRATION_KINDS) {
      expect(TILL_LINK_TYPES[kind].menu).toEqual([])
      expect(TILL_LINK_TYPES[kind].special).toEqual([])
    }
  })
})

describe('tillLinkTypeProblem', () => {
  it("accepts a kind's declared types and refuses the rest", () => {
    expect(tillLinkTypeProblem('barsy', 'item', 'article')).toBeNull()
    expect(tillLinkTypeProblem('barsy', 'section', 'category')).toBeNull()
    expect(tillLinkTypeProblem('barsy', 'item', 'category')).toBe(
      'a item links to a article, not a category',
    )
    expect(tillLinkTypeProblem('barsy', 'menu', 'article')).toBe('a menu takes no till link')
  })

  it('refuses a kind that declares no link types', () => {
    expect(tillLinkTypeProblem('mystery', 'item', 'article')).toBe(
      'the connector kind mystery declares no link types',
    )
    // Not even through a key that every object has.
    expect(tillLinkTypeProblem('toString', 'item', 'article')).not.toBeNull()
  })

  it('checks a second kind, added in a test-only map, exactly like the first (no kind is special)', () => {
    const withSecond: TillLinkTypes = {
      ...TILL_LINK_TYPES,
      second: {
        menu: [],
        section: ['group'],
        item: ['product'],
        modifier_group: ['modifier_list'],
        option: ['modifier'],
        special: [],
      },
    }
    expect(tillLinkTypeProblem('second', 'item', 'product', withSecond)).toBeNull()
    expect(tillLinkTypeProblem('second', 'section', 'group', withSecond)).toBeNull()
    // The first kind's words mean nothing to the second, and the other way round.
    expect(tillLinkTypeProblem('second', 'item', 'article', withSecond)).toBe(
      'a item links to a product, not a article',
    )
    expect(tillLinkTypeProblem('barsy', 'item', 'product', withSecond)).not.toBeNull()
    expect(tillLinkTypeProblem('second', 'menu', 'product', withSecond)).toBe(
      'a menu takes no till link',
    )
    // Without the test map the second kind is unknown and links nothing.
    expect(tillLinkTypeProblem('second', 'item', 'product')).not.toBeNull()
  })
})
