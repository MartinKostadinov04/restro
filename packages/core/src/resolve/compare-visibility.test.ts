import { describe, expect, it } from 'vitest'

import { compareVisibility, V11_MAX_HIDDEN_SHARE } from './compare-visibility'
import { nd } from './fixtures'

const [a, b, c, d] = [nd('a'), nd('b'), nd('c'), nd('d')]

describe('compareVisibility (input for V11)', () => {
  it('counts previously visible items that are hidden or removed', () => {
    const prev = {
      items: {
        [a]: { visible: true },
        [b]: { visible: true },
        [c]: { visible: true },
        [d]: { visible: false },
      },
    }
    const next = {
      items: { [a]: { visible: true }, [b]: { visible: false }, [d]: { visible: true } },
    }
    expect(compareVisibility(prev, next)).toEqual({
      hiddenShare: 2 / 3,
      hiddenItemIds: [b, c].sort(),
      previouslyVisible: 3,
    })
  })

  it('is 0 when nothing was visible before, or nothing was hidden', () => {
    expect(
      compareVisibility({ items: {} }, { items: { [a]: { visible: true } } }).hiddenShare,
    ).toBe(0)
    const same = { items: { [a]: { visible: true } } }
    expect(compareVisibility(same, same)).toEqual({
      hiddenShare: 0,
      hiddenItemIds: [],
      previouslyVisible: 1,
    })
  })

  it("exposes the doc's 30% limit", () => {
    expect(V11_MAX_HIDDEN_SHARE).toBe(0.3)
  })
})
