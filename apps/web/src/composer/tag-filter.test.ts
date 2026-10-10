import { describe, expect, it } from 'vitest'

import { activeTagIds, filterByTags } from './tag-filter'
import { makeTestView } from './test-view'

describe('filterByTags', () => {
  it('shows everything when no tag is chosen, in the list’s order', () => {
    const { view, ids } = makeTestView()
    const all = [ids.negroni, ids.spritz]
    expect(filterByTags(view, all, new Set())).toEqual(all)
  })

  it('shows the items that hold at least one of the chosen tags', () => {
    const { view, ids } = makeTestView()
    const all = [ids.negroni, ids.spritz, ids.daiquiri]
    expect(filterByTags(view, all, new Set([ids.local]))).toEqual([ids.spritz])
    expect(filterByTags(view, all, new Set([ids.signature]))).toEqual([ids.negroni])
    expect(filterByTags(view, all, new Set([ids.local, ids.spicy]))).toEqual([
      ids.negroni,
      ids.spritz,
    ])
  })

  it('shows nothing when no item in the list holds the chosen tag', () => {
    const { view, ids } = makeTestView()
    expect(filterByTags(view, [ids.lager, ids.stout], new Set([ids.local]))).toEqual([])
  })
})

describe('activeTagIds', () => {
  it('lists the non-archived tags in the venue’s order', () => {
    const { view, ids } = makeTestView()
    expect(activeTagIds(view)).toEqual([ids.signature, ids.spicy, ids.local])
  })
})
