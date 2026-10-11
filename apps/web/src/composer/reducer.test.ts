import { newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { reduceView } from './reducer'
import { makeTestView } from './test-view'
import type { ComposerItem, ComposerSection } from './view-model'

const itemIdsIn = (view: ReturnType<typeof makeTestView>['view'], sectionId: string): string[] =>
  (view.placements[sectionId as keyof typeof view.placements] ?? []).map((p) => p.itemId)

describe('reduceView: placing items', () => {
  it('reorders inside a section by the new key', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'placeItem',
      itemId: ids.spritz,
      fromSectionId: ids.cocktails,
      toSectionId: ids.cocktails,
      keys: [{ id: ids.spritz, key: 'Zz' }],
    })
    expect(itemIdsIn(next, ids.cocktails)).toEqual([ids.spritz, ids.negroni])
    // The base view is untouched: that is what a rollback shows.
    expect(itemIdsIn(view, ids.cocktails)).toEqual([ids.negroni, ids.spritz])
  })

  it('moves an item to another section and out of the first', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'placeItem',
      itemId: ids.negroni,
      fromSectionId: ids.cocktails,
      toSectionId: ids.beer,
      keys: [{ id: ids.negroni, key: 'a2' }],
    })
    expect(itemIdsIn(next, ids.cocktails)).toEqual([ids.spritz])
    expect(itemIdsIn(next, ids.beer)).toEqual([ids.lager, ids.stout, ids.negroni])
    expect(next.unsortedIds).toEqual([ids.water])
  })

  it('takes an unsorted item into a section, and a section item into Unsorted', () => {
    const { view, ids } = makeTestView()
    const placed = reduceView(view, {
      type: 'placeItem',
      itemId: ids.water,
      fromSectionId: null,
      toSectionId: ids.beer,
      keys: [{ id: ids.water, key: 'Zz' }],
    })
    expect(itemIdsIn(placed, ids.beer)).toEqual([ids.water, ids.lager, ids.stout])
    expect(placed.unsortedIds).toEqual([])

    const unsorted = reduceView(placed, {
      type: 'placeItem',
      itemId: ids.lager,
      fromSectionId: ids.beer,
      toSectionId: null,
      keys: [],
    })
    expect(itemIdsIn(unsorted, ids.beer)).toEqual([ids.water, ids.stout])
    expect(unsorted.unsortedIds).toEqual([ids.lager])
  })

  it('applies a re-spacing of the whole list', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'placeItem',
      itemId: ids.water,
      fromSectionId: null,
      toSectionId: ids.beer,
      keys: [
        { id: ids.lager, key: 'a0' },
        { id: ids.water, key: 'a1' },
        { id: ids.stout, key: 'a2' },
      ],
    })
    expect(itemIdsIn(next, ids.beer)).toEqual([ids.lager, ids.water, ids.stout])
  })

  it('keeps an item that is placed in two sections out of Unsorted when it leaves one', () => {
    const { view, ids } = makeTestView()
    const twice = reduceView(view, {
      type: 'placeItem',
      itemId: ids.lager,
      fromSectionId: null,
      toSectionId: ids.cocktails,
      keys: [{ id: ids.lager, key: 'a9' }],
    })
    const next = reduceView(twice, {
      type: 'placeItem',
      itemId: ids.lager,
      fromSectionId: ids.beer,
      toSectionId: null,
      keys: [],
    })
    expect(next.unsortedIds).toEqual([ids.water])
  })
})

describe('reduceView: moving sections', () => {
  it('reorders top-level sections', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'moveSection',
      sectionId: ids.beer,
      parentId: null,
      keys: [{ id: ids.beer, key: 'Zz' }],
    })
    expect(next.rootIds).toEqual([ids.beer, ids.cocktails])
  })

  it('moves a section under another, last among its children', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'moveSection',
      sectionId: ids.beer,
      parentId: ids.cocktails,
      keys: [{ id: ids.beer, key: 'a1' }],
    })
    expect(next.rootIds).toEqual([ids.cocktails])
    expect(next.sections[ids.cocktails]?.childIds).toEqual([ids.classics, ids.beer])
    expect(next.sections[ids.beer]).toMatchObject({ parentId: ids.cocktails, sortKey: 'a1' })
  })

  it('moves a nested section to the top level', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'moveSection',
      sectionId: ids.classics,
      parentId: null,
      keys: [{ id: ids.classics, key: 'a2' }],
    })
    expect(next.rootIds).toEqual([ids.cocktails, ids.beer, ids.classics])
    expect(next.sections[ids.cocktails]?.childIds).toEqual([])
    // Its own children travel with it.
    expect(next.sections[ids.classics]?.childIds).toEqual([ids.stirred])
  })
})

describe('reduceView: hiding and creating', () => {
  it('hides and shows what the builder owns', () => {
    const { view, ids } = makeTestView()
    const hidden = reduceView(view, { type: 'setItemHidden', itemId: ids.negroni, hidden: true })
    expect(hidden.items[ids.negroni]).toMatchObject({ hiddenBy: 'builder', shown: false })
    const shown = reduceView(hidden, { type: 'setItemHidden', itemId: ids.negroni, hidden: false })
    expect(shown.items[ids.negroni]).toMatchObject({ hiddenBy: null, shown: true })
  })

  it('shows a new item the sync held for review: the badge goes with the hide (S3-04)', () => {
    const { view, ids } = makeTestView()
    const held = {
      ...view,
      items: {
        ...view.items,
        [ids.stout]: {
          ...(view.items[ids.stout] as object),
          hiddenBy: 'new_from_till' as const,
          shown: false,
        },
      },
    } as typeof view
    const shown = reduceView(held, { type: 'setItemHidden', itemId: ids.stout, hidden: false })
    expect(shown.items[ids.stout]).toMatchObject({ hiddenBy: null, shown: true })
    // Hidden again by the person: that hide is theirs, not "new from barsy".
    const again = reduceView(shown, { type: 'setItemHidden', itemId: ids.stout, hidden: true })
    expect(again.items[ids.stout]?.hiddenBy).toBe('builder')
  })

  it('never shows an item barsy hides (rule 5)', () => {
    const { view, ids } = makeTestView()
    const barsyHidden = {
      ...view,
      items: {
        ...view.items,
        [ids.stout]: {
          ...(view.items[ids.stout] as object),
          hiddenBy: 'till' as const,
          shown: false,
        },
      },
    } as typeof view
    expect(
      reduceView(barsyHidden, { type: 'setItemHidden', itemId: ids.stout, hidden: false }),
    ).toBe(barsyHidden)
    expect(
      reduceView(barsyHidden, { type: 'setItemHidden', itemId: ids.stout, hidden: true }),
    ).toBe(barsyHidden)
  })

  it('hides and shows a section', () => {
    const { view, ids } = makeTestView()
    const hidden = reduceView(view, { type: 'setSectionHidden', sectionId: ids.beer, hidden: true })
    expect(hidden.sections[ids.beer]).toMatchObject({ hidden: true, shown: false })
    const shown = reduceView(hidden, {
      type: 'setSectionHidden',
      sectionId: ids.beer,
      hidden: false,
    })
    expect(shown.sections[ids.beer]).toMatchObject({ hidden: false, shown: true })
  })

  it('adds a section at the end of its parent, once', () => {
    const { view, ids } = makeTestView()
    const section: ComposerSection = {
      id: newId('nd'),
      parentId: ids.cocktails,
      title: 'Signature',
      origin: 'owned',
      hidden: false,
      shown: false,
      sortKey: 'a1',
      childIds: [],
      issues: [],
    }
    const next = reduceView(view, { type: 'addSection', section })
    expect(next.sections[ids.cocktails]?.childIds).toEqual([ids.classics, section.id])
    expect(next.placements[section.id]).toEqual([])
    expect(reduceView(next, { type: 'addSection', section })).toBe(next)

    const top = reduceView(view, {
      type: 'addSection',
      section: { ...section, parentId: null, sortKey: 'a2' },
    })
    expect(top.rootIds).toEqual([ids.cocktails, ids.beer, section.id])
  })
})

describe('reduceView: a new item made by hand', () => {
  const newItem = (name: string, extra: Partial<ComposerItem> = {}): ComposerItem => ({
    id: newId('nd'),
    name,
    price: { amount_minor: 450, currency: 'EUR' },
    origin: 'owned',
    hiddenBy: null,
    shown: false,
    issues: [{ code: 'V4', severity: 'warning', fieldKey: 'allergens' }],
    tags: [],
    dietary: [],
    soldOutTonight: false,
    offSale: null,
    ...extra,
  })

  it('goes to the end of the open section, with the key the action writes', () => {
    const { view, ids } = makeTestView()
    const item = newItem('Mojito')
    const next = reduceView(view, {
      type: 'addItem',
      item,
      sectionId: ids.beer,
      sortKey: 'a5',
      locale: 'en_US',
    })
    expect(next.items[item.id]).toBe(item)
    expect(itemIdsIn(next, ids.beer)).toEqual([ids.lager, ids.stout, item.id])
    expect(next.placements[ids.beer]?.at(-1)).toEqual({ itemId: item.id, sortKey: 'a5' })
    // It is placed, so it is not unsorted; the other lists are untouched.
    expect(next.unsortedIds).toEqual(view.unsortedIds)
    expect(next.placements[ids.cocktails]).toBe(view.placements[ids.cocktails])
    // The base view is untouched: that is what a rollback shows.
    expect(view.items[item.id]).toBeUndefined()
    expect(itemIdsIn(view, ids.beer)).toEqual([ids.lager, ids.stout])
  })

  it('starts in Unsorted, by name, when it is made there', () => {
    const { view, ids } = makeTestView()
    const item = newItem('Absinthe')
    const next = reduceView(view, {
      type: 'addItem',
      item,
      sectionId: null,
      sortKey: 'a0',
      locale: 'en_US',
    })
    expect(next.unsortedIds).toEqual([item.id, ids.water])
    expect(
      Object.values(next.placements)
        .flat()
        .map((p) => p.itemId),
    ).not.toContain(item.id)
  })

  it('keeps an item whose section vanished in Unsorted, and ignores a repeat', () => {
    const { view, ids } = makeTestView()
    const item = newItem('Zebra')
    const lost = reduceView(view, {
      type: 'addItem',
      item,
      sectionId: newId('nd'),
      sortKey: 'a0',
      locale: 'bg_BG',
    })
    expect(lost.unsortedIds).toEqual([ids.water, item.id])
    const op = {
      type: 'addItem',
      item,
      sectionId: ids.beer,
      sortKey: 'a9',
      locale: 'bg_BG',
    } as const
    const once = reduceView(view, op)
    expect(reduceView(once, op)).toBe(once)
  })
})

describe('reduceView: tags (S3-06)', () => {
  it('adds and removes tags on a selection of items, keeping what each holds', () => {
    const { view, ids } = makeTestView()
    const next = reduceView(view, {
      type: 'setItemTags',
      itemIds: [ids.negroni, ids.spritz, ids.lager],
      add: [ids.local],
      remove: [ids.spicy],
    })
    expect([...(next.items[ids.negroni]?.tags ?? [])].sort()).toEqual(
      [ids.signature, ids.old, ids.local].sort(),
    )
    // Spritz held Local already: no repeat.
    expect(next.items[ids.spritz]?.tags).toEqual([ids.local])
    expect(next.items[ids.lager]?.tags).toEqual([ids.local])
    // Items outside the selection and the base view are untouched.
    expect(next.items[ids.stout]).toBe(view.items[ids.stout])
    expect(view.items[ids.lager]?.tags).toEqual([])
  })

  it('creates a tag at the end and changes one in place', () => {
    const { view, ids } = makeTestView()
    const created = {
      id: newId('tg'),
      name: 'New',
      label: { bg_BG: 'New' },
      color: 'accent' as const,
      archived: false,
    }
    const added = reduceView(view, { type: 'upsertTag', tag: created })
    expect(added.tagIds).toEqual([...view.tagIds, created.id])
    expect(added.tags[created.id]).toEqual(created)

    const spicy = view.tags[ids.spicy]
    if (!spicy) throw new Error('the test view has the Spicy tag')
    const archived = reduceView(added, { type: 'upsertTag', tag: { ...spicy, archived: true } })
    expect(archived.tagIds).toEqual(added.tagIds)
    expect(archived.tags[ids.spicy]?.archived).toBe(true)
    expect(view.tags[ids.spicy]?.archived).toBe(false)
  })

  it('moves a tag before another, or to the end', () => {
    const { view, ids } = makeTestView()
    const before = reduceView(view, { type: 'moveTag', tagId: ids.local, beforeId: ids.signature })
    expect(before.tagIds).toEqual([ids.local, ids.signature, ids.spicy, ids.old])
    const end = reduceView(view, { type: 'moveTag', tagId: ids.signature, beforeId: null })
    expect(end.tagIds).toEqual([ids.spicy, ids.local, ids.old, ids.signature])
    expect(view.tagIds).toEqual([ids.signature, ids.spicy, ids.local, ids.old])
  })
})
