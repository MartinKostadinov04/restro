import { newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { beforeIdForDrop } from './tag-order'

const [a, b, c, d] = [newId('tg'), newId('tg'), newId('tg'), newId('tg')]

describe('beforeIdForDrop', () => {
  const listed = [a, b, c, d]

  it('a tag dropped higher goes before the tag now at that place', () => {
    expect(beforeIdForDrop(listed, c, 0)).toBe(a)
    expect(beforeIdForDrop(listed, d, 1)).toBe(b)
  })

  it('a tag dropped lower goes before the one that follows it, or to the end', () => {
    // a dragged to index 1 lands between b and c.
    expect(beforeIdForDrop(listed, a, 1)).toBe(c)
    expect(beforeIdForDrop(listed, a, 3)).toBeNull()
    expect(beforeIdForDrop(listed, b, 2)).toBe(d)
  })

  it('the last place is the end', () => {
    expect(beforeIdForDrop(listed, a, listed.length - 1)).toBeNull()
  })
})
