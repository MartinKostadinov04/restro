import { type ChangeSetOp, newId, parseChangeSet } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  createSectionOps,
  moveSectionOps,
  placeItemOps,
  setItemHiddenOps,
  setSectionHiddenOps,
} from './ops'

const menu = newId('nd')
const a = newId('nd')
const b = newId('nd')
const item = newId('nd')

/** Wraps ops the way the server actions do; the set must parse. */
function asManualSet(ops: ChangeSetOp[] | null) {
  expect(ops).not.toBeNull()
  const parsed = parseChangeSet({
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:abcDEF123456',
    observedAt: new Date().toISOString(),
    ops,
  })
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value.ops
}

describe('placeItemOps', () => {
  it('moves an item: place it in the new section, then take it out of the old one', () => {
    const ops = asManualSet(
      placeItemOps({
        itemId: item,
        fromSectionId: a,
        toSectionId: b,
        keys: [{ id: item, key: 'a3' }],
      }),
    )
    expect(ops).toEqual([
      { op: 'setPlacement', item: { id: item }, section: { id: b }, sortKey: 'a3' },
      { op: 'removePlacement', item: { id: item }, section: { id: a } },
    ])
  })

  it('reorders in place with one setPlacement and no removal', () => {
    const ops = asManualSet(
      placeItemOps({
        itemId: item,
        fromSectionId: a,
        toSectionId: a,
        keys: [{ id: item, key: 'Zz' }],
      }),
    )
    expect(ops).toHaveLength(1)
  })

  it('writes every key of a re-spaced list', () => {
    const other = newId('nd')
    const ops = asManualSet(
      placeItemOps({
        itemId: item,
        fromSectionId: null,
        toSectionId: a,
        keys: [
          { id: other, key: 'a0' },
          { id: item, key: 'a1' },
        ],
      }),
    )
    expect(ops.map((op) => op.op)).toEqual(['setPlacement', 'setPlacement'])
  })

  it('takes an item out of a section (to Unsorted)', () => {
    const ops = asManualSet(
      placeItemOps({ itemId: item, fromSectionId: a, toSectionId: null, keys: [] }),
    )
    expect(ops).toEqual([{ op: 'removePlacement', item: { id: item }, section: { id: a } }])
  })

  it('refuses a request without the item’s own key, and one that does nothing', () => {
    expect(
      placeItemOps({
        itemId: item,
        fromSectionId: a,
        toSectionId: b,
        keys: [{ id: a, key: 'a0' }],
      }),
    ).toBeNull()
    expect(
      placeItemOps({ itemId: item, fromSectionId: null, toSectionId: null, keys: [] }),
    ).toBeNull()
  })
})

describe('moveSectionOps', () => {
  it('moves under a section, or to the menu for the top level', () => {
    expect(
      asManualSet(
        moveSectionOps({ sectionId: a, parentId: b, menuId: menu, keys: [{ id: a, key: 'a0' }] }),
      ),
    ).toEqual([{ op: 'moveNode', node: { id: a }, parent: { id: b }, sortKey: 'a0' }])
    expect(
      asManualSet(
        moveSectionOps({
          sectionId: a,
          parentId: null,
          menuId: menu,
          keys: [{ id: a, key: 'a0' }],
        }),
      ),
    ).toEqual([{ op: 'moveNode', node: { id: a }, parent: { id: menu }, sortKey: 'a0' }])
  })

  it('refuses a request without the section’s own key', () => {
    expect(moveSectionOps({ sectionId: a, parentId: null, menuId: menu, keys: [] })).toBeNull()
  })
})

describe('createSectionOps', () => {
  it('creates the section and titles it in the manual layer', () => {
    const ops = asManualSet(
      createSectionOps({
        id: a,
        parentId: null,
        menuId: menu,
        title: { bg_BG: 'Коктейли на вечерта', en_US: 'Tonight’s cocktails' },
        sortKey: 'a4',
      }),
    )
    expect(ops).toEqual([
      {
        op: 'createNode',
        id: a,
        nodeType: 'section',
        parent: { id: menu },
        status: 'active',
        sortKey: 'a4',
      },
      {
        op: 'setField',
        node: { id: a },
        fieldKey: 'title',
        layer: 'manual',
        scope: 'master',
        value: { bg_BG: 'Коктейли на вечерта', en_US: 'Tonight’s cocktails' },
      },
    ])
  })
})

describe('hiding and showing', () => {
  it('hides an item with a manual-layer false, never in the barsy layer', () => {
    const ops = asManualSet(setItemHiddenOps({ itemId: item, hidden: true, status: 'active' }))
    expect(ops).toEqual([
      {
        op: 'setField',
        node: { id: item },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
        value: false,
      },
    ])
  })

  it('shows an item by clearing only the manual value (rule 5)', () => {
    const ops = asManualSet(setItemHiddenOps({ itemId: item, hidden: false, status: 'active' }))
    expect(ops).toEqual([
      {
        op: 'clearField',
        node: { id: item },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
      },
    ])
    for (const op of ops) expect(JSON.stringify(op)).not.toContain('barsy')
  })

  it('also makes a held-back item active when it is shown', () => {
    const ops = asManualSet(setItemHiddenOps({ itemId: item, hidden: false, status: 'hidden' }))
    expect(ops.map((op) => op.op)).toEqual(['clearField', 'setNodeStatus'])
  })

  it('hides and shows a section through its status', () => {
    expect(asManualSet(setSectionHiddenOps({ sectionId: a, hidden: true }))).toEqual([
      { op: 'setNodeStatus', node: { id: a }, status: 'hidden' },
    ])
    expect(asManualSet(setSectionHiddenOps({ sectionId: a, hidden: false }))).toEqual([
      { op: 'setNodeStatus', node: { id: a }, status: 'active' },
    ])
  })
})
