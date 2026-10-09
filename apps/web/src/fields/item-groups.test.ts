import { VENUE_MENU_TEMPLATE } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { ITEM_GROUPS } from './item-groups'

describe('the item groups', () => {
  it('hold every Item field of the default template exactly once', () => {
    const keys = ITEM_GROUPS.flatMap((group) => group.keys) as string[]
    const fields = (VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []).map((field) => field.key)
    expect([...keys].sort()).toEqual([...fields].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('list the fields of each group in template order', () => {
    const order = (VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []).map((field) => field.key)
    for (const group of ITEM_GROUPS) {
      const positions = group.keys.map((key) => order.indexOf(key))
      expect(positions, group.id).toEqual([...positions].sort((a, b) => a - b))
    }
  })
})
