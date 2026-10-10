import { newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  itemDraggableId,
  parseDraggable,
  parseItemDroppable,
  parseSectionList,
  resolveDrop,
  resolvePointerDrop,
  sectionDraggableId,
  UNSORTED_KEY,
} from './dnd'

const a = newId('nd')
const b = newId('nd')
const item = newId('nd')

describe('drag and drop ids', () => {
  it('read back what was built', () => {
    expect(parseDraggable(itemDraggableId(item))).toEqual({ kind: 'item', id: item })
    expect(parseDraggable(sectionDraggableId(a))).toEqual({ kind: 'section', id: a })
    expect(parseDraggable('item:nope')).toBeNull()
    expect(parseDraggable(`thing:${a}`)).toBeNull()

    expect(parseItemDroppable(`items:${a}`)).toEqual({ kind: 'list', sectionId: a })
    expect(parseItemDroppable(`target:${a}`)).toEqual({ kind: 'target', sectionId: a })
    expect(parseItemDroppable(`items:${UNSORTED_KEY}`)).toEqual({ kind: 'list', sectionId: null })
    expect(parseItemDroppable(`target:${UNSORTED_KEY}`)).toEqual({
      kind: 'target',
      sectionId: null,
    })
    expect(parseItemDroppable('items:oops')).toBeNull()
    expect(parseItemDroppable(`children:${a}`)).toBeNull()

    expect(parseSectionList(`children:${a}`)).toEqual({ parentId: a })
    expect(parseSectionList('children:root')).toEqual({ parentId: null })
    expect(parseSectionList('children:oops')).toBeNull()
    expect(parseSectionList(`items:${a}`)).toBeNull()
  })
})

describe('resolveDrop: items', () => {
  const drag = (from: string, fromIndex: number, to: string | null, toIndex = 0) => ({
    draggableId: itemDraggableId(item),
    source: { droppableId: from, index: fromIndex },
    destination: to === null ? null : { droppableId: to, index: toIndex },
  })

  it('does nothing when dropped outside every list, or where it was', () => {
    expect(resolveDrop(drag(`items:${a}`, 1, null))).toBeNull()
    expect(resolveDrop(drag(`items:${a}`, 1, `items:${a}`, 1))).toBeNull()
  })

  it('reorders inside a section at the dropped index', () => {
    expect(resolveDrop(drag(`items:${a}`, 3, `items:${a}`, 0))).toEqual({
      kind: 'placeItem',
      itemId: item,
      fromSectionId: a,
      toSectionId: a,
      index: 0,
    })
  })

  it('moves to the end of the section whose tree row it was dropped on', () => {
    expect(resolveDrop(drag(`items:${a}`, 0, `target:${b}`))).toEqual({
      kind: 'placeItem',
      itemId: item,
      fromSectionId: a,
      toSectionId: b,
      index: undefined,
    })
  })

  it('does nothing when dropped on the row of its own section', () => {
    expect(resolveDrop(drag(`items:${a}`, 0, `target:${a}`))).toBeNull()
  })

  it('takes an item out of its section when dropped on Unsorted, and places one from Unsorted', () => {
    expect(resolveDrop(drag(`items:${a}`, 0, `target:${UNSORTED_KEY}`))).toEqual({
      kind: 'placeItem',
      itemId: item,
      fromSectionId: a,
      toSectionId: null,
      index: undefined,
    })
    expect(resolveDrop(drag(`items:${UNSORTED_KEY}`, 0, `target:${b}`))).toEqual({
      kind: 'placeItem',
      itemId: item,
      fromSectionId: null,
      toSectionId: b,
      index: undefined,
    })
  })

  it('has no order inside Unsorted', () => {
    expect(resolveDrop(drag(`items:${UNSORTED_KEY}`, 0, `items:${UNSORTED_KEY}`, 2))).toBeNull()
  })

  it('ignores a drag that does not start in an item list', () => {
    expect(resolveDrop(drag(`target:${a}`, 0, `items:${b}`))).toBeNull()
    expect(resolveDrop(drag('children:root', 0, `items:${b}`))).toBeNull()
  })
})

describe('resolveDrop: sections', () => {
  const drag = (from: string, fromIndex: number, to: string | null, toIndex = 0) => ({
    draggableId: sectionDraggableId(a),
    source: { droppableId: from, index: fromIndex },
    destination: to === null ? null : { droppableId: to, index: toIndex },
  })

  it('reorders among the siblings of the same list', () => {
    expect(resolveDrop(drag('children:root', 2, 'children:root', 0))).toEqual({
      kind: 'moveSection',
      sectionId: a,
      parentId: null,
      index: 0,
    })
    expect(resolveDrop(drag(`children:${b}`, 0, `children:${b}`, 3))).toEqual({
      kind: 'moveSection',
      sectionId: a,
      parentId: b,
      index: 3,
    })
  })

  it('does nothing when dropped where it was or outside', () => {
    expect(resolveDrop(drag('children:root', 1, 'children:root', 1))).toBeNull()
    expect(resolveDrop(drag('children:root', 1, null))).toBeNull()
  })

  it('does not take a drop into another sibling list (reparenting is "Move to")', () => {
    expect(resolveDrop(drag('children:root', 0, `children:${b}`, 0))).toBeNull()
  })
})

describe('resolvePointerDrop', () => {
  const drop = (from: string) => ({
    draggableId: itemDraggableId(item),
    source: { droppableId: from, index: 0 },
  })

  it('puts the item in the section whose tree row the pointer is on', () => {
    expect(resolvePointerDrop(drop(`items:${a}`), b)).toEqual({
      kind: 'placeItem',
      itemId: item,
      fromSectionId: a,
      toSectionId: b,
      index: undefined,
    })
    expect(resolvePointerDrop(drop(`items:${UNSORTED_KEY}`), b)).toMatchObject({
      fromSectionId: null,
      toSectionId: b,
    })
    expect(resolvePointerDrop(drop(`items:${a}`), UNSORTED_KEY)).toMatchObject({
      fromSectionId: a,
      toSectionId: null,
    })
  })

  it('does nothing on the row of its own section, or for something that is not an item', () => {
    expect(resolvePointerDrop(drop(`items:${a}`), a)).toBeNull()
    expect(resolvePointerDrop(drop(`items:${UNSORTED_KEY}`), UNSORTED_KEY)).toBeNull()
    expect(
      resolvePointerDrop(
        { draggableId: sectionDraggableId(a), source: { droppableId: 'children:root', index: 0 } },
        b,
      ),
    ).toBeNull()
    expect(resolvePointerDrop(drop(`items:${a}`), 'nope')).toBeNull()
  })
})
