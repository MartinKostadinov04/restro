import { newId, parseChangeSet } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  DEMO_ITEMS,
  DEMO_OWNED_ITEM,
  DEMO_SECTIONS,
  demoManualChangeSet,
  demoOwnedItemChangeSet,
  demoPullChangeSet,
  demoSourceRecords,
} from './demo-menu'

function pullInput() {
  const records = demoSourceRecords()
  const byType = (type: string) =>
    new Map(
      records
        .filter((record) => record.externalType === type)
        .map((record) => [record.externalId, newId('sr')]),
    )
  return {
    integrationId: newId('in'),
    venueId: newId('vn'),
    menuId: newId('nd'),
    categoryRecords: byType('category'),
    articleRecords: byType('article'),
  }
}

describe('the demo menu', () => {
  it('has four sections and about twenty items with Bulgarian names, half of them in English', () => {
    expect(DEMO_SECTIONS.map((section) => section.title.bg_BG)).toEqual([
      'Коктейли',
      'Бира',
      'Безалкохолни',
      'Храна',
    ])
    const placed = DEMO_ITEMS.filter((item) => item.section !== null)
    expect(placed).toHaveLength(20)
    expect(DEMO_ITEMS.filter((item) => item.section === null)).toHaveLength(1)
    const english = DEMO_ITEMS.filter((item) => item.en !== undefined)
    expect(english.length).toBeGreaterThanOrEqual(DEMO_ITEMS.length / 2 - 1)
    expect(english.length).toBeLessThan(DEMO_ITEMS.length)
    for (const item of DEMO_ITEMS) expect(item.bg).toMatch(/[Ѐ-ӿ]/)
  })

  it('has one item barsy hides, one description written here, a few allergen sets, two unplaced', () => {
    expect(DEMO_ITEMS.filter((item) => item.hiddenByBarsy)).toHaveLength(1)
    expect(DEMO_ITEMS.filter((item) => item.description)).toHaveLength(1)
    expect(
      DEMO_ITEMS.filter((item) => item.allergens && item.allergens.length > 0).length,
    ).toBeGreaterThan(3)
    // The unplaced ones: a barsy article in no category, and the one made here.
    expect(DEMO_ITEMS.filter((item) => item.section === null).length + 1).toBe(2)
    expect(DEMO_OWNED_ITEM.name.bg_BG).toBe('Лимонада на къщата')
  })

  it('makes up distinct external ids and one source record for each', () => {
    const records = demoSourceRecords()
    expect(records).toHaveLength(DEMO_SECTIONS.length + DEMO_ITEMS.length)
    const keys = records.map((record) => `${record.externalType}:${record.externalId}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const record of records) expect(JSON.parse(record.raw)).toEqual(record.payload)
  })
})

describe('demoPullChangeSet', () => {
  it('is a valid barsy change set: barsy layer only, links, placements at the end', () => {
    const input = pullInput()
    const set = demoPullChangeSet(input)
    const parsed = parseChangeSet(set)
    if (!parsed.ok) throw new Error(parsed.reason)
    const ops = parsed.value.ops
    expect(parsed.value.source).toBe(`barsy:${input.integrationId}`)

    const creates = ops.filter((op) => op.op === 'createNode')
    expect(creates.filter((op) => op.nodeType === 'section')).toHaveLength(4)
    expect(creates.filter((op) => op.nodeType === 'item')).toHaveLength(DEMO_ITEMS.length)
    expect(ops.filter((op) => op.op === 'linkSource')).toHaveLength(
      DEMO_SECTIONS.length + DEMO_ITEMS.length,
    )
    for (const op of ops) {
      if (op.op === 'setField') {
        expect(op.layer).toBe('barsy')
        expect(op.mappingVersion).toBe(1)
        expect(op.sourceRecordId).toMatch(/^sr_/)
      }
      if (op.op === 'setPlacement') expect(op.sortKey).toBe('end')
    }
    expect(ops.filter((op) => op.op === 'setPlacement')).toHaveLength(20)
  })

  it('prices and puts on sale per venue, in integer euro cents', () => {
    const input = pullInput()
    const ops = demoPullChangeSet(input).ops
    const prices = ops.filter((op) => op.op === 'setField' && op.fieldKey === 'price')
    expect(prices).toHaveLength(DEMO_ITEMS.length)
    for (const op of prices) {
      if (op.op !== 'setField') continue
      expect(op.scope).toBe(`venue:${input.venueId}`)
      const value = op.value as { amount_minor: number; currency: string }
      expect(Number.isInteger(value.amount_minor)).toBe(true)
      expect(value.currency).toBe('EUR')
    }
    const hidden = ops.filter(
      (op) => op.op === 'setField' && op.fieldKey === 'visible' && op.value === false,
    )
    expect(hidden).toHaveLength(1)
  })

  it('can be applied twice: each run names new ids, and identity comes from the links', () => {
    const input = pullInput()
    const first = demoPullChangeSet(input)
    const second = demoPullChangeSet(input)
    const created = (set: typeof first) =>
      set.ops.flatMap((op) => (op.op === 'createNode' ? [op.id] : []))
    expect(created(first)).not.toEqual(created(second))
  })
})

describe('the manual parts of the demo', () => {
  it('writes the description in the manual layer on the item that has it', () => {
    const nodes = new Map(DEMO_ITEMS.map((item) => [item.externalId, newId('nd')]))
    const set = demoManualChangeSet({ userId: 'abcDEF123456', nodeIdByArticle: nodes })
    expect(set).not.toBeNull()
    if (!set) return
    expect(parseChangeSet(set).ok).toBe(true)
    expect(set.ops).toHaveLength(1)
    expect(set.ops[0]).toMatchObject({ op: 'setField', fieldKey: 'description', layer: 'manual' })
  })

  it('has nothing to write when the items are not there yet', () => {
    expect(demoManualChangeSet({ userId: 'abcDEF123456', nodeIdByArticle: new Map() })).toBeNull()
  })

  it('creates the hand-made item with a name and description and no link', () => {
    const itemId = newId('nd')
    const set = demoOwnedItemChangeSet({ userId: 'abcDEF123456', itemId })
    expect(parseChangeSet(set).ok).toBe(true)
    expect(set.ops.map((op) => op.op)).toEqual(['createNode', 'setField', 'setField'])
  })
})
