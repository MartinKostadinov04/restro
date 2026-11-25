// Demo Bar's seed data (#71): read from the scenario file the simulator loads, described as one
// change set under the instance's POS source. Pure, so no database.
import { ChangeSetSchema, newId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  DEMO_BAR_SCENARIO,
  demoBarPullChangeSet,
  demoBarSourceRecords,
  loadDemoBarScenario,
  recordKey,
} from './demo-bar'

const integrationId = newId('in')
const venueId = newId('vn')
const menuId = newId('nd')

function changeSet() {
  const scenario = loadDemoBarScenario()
  const records = new Map(
    demoBarSourceRecords(scenario).map((record) => [
      recordKey(record.externalType, record.externalId),
      newId('sr'),
    ]),
  )
  return {
    scenario,
    set: demoBarPullChangeSet({ scenario, integrationId, venueId, menuId, records }),
  }
}

describe('Demo Bar seed data', () => {
  it('reads the same scenario the simulator starts from, with its four payment tables', () => {
    const scenario = loadDemoBarScenario()
    expect(scenario.name).toBe(DEMO_BAR_SCENARIO)
    expect([...scenario.paymentTableNames].sort()).toEqual(['PM1', 'PM2', 'PU1', 'PU2'])
    expect(scenario.articles.size).toBeGreaterThanOrEqual(28)
  })

  it('refuses a scenario name that is a path', () => {
    expect(() => loadDemoBarScenario('../package')).toThrow(/not a scenario name/)
    expect(() => loadDemoBarScenario('no-such-night')).toThrow()
  })

  it('writes the menu under the POS source: only till-layer values, each citing a record', () => {
    const { set } = changeSet()
    expect(ChangeSetSchema.safeParse(set).success).toBe(true)
    expect(set.source).toBe(`till:${integrationId}`)
    const writes = set.ops.filter((op) => op.op === 'setField')
    expect(writes.length).toBeGreaterThan(100)
    for (const write of writes) {
      expect(write).toMatchObject({ layer: 'till', mappingVersion: 1 })
      expect((write as { sourceRecordId?: string }).sourceRecordId).toMatch(/^sr_/)
    }
  })

  it('makes a section for each category and an item, with its price, for each article of the menu', () => {
    const { scenario, set } = changeSet()
    const sections = set.ops.filter((op) => op.op === 'createNode' && op.nodeType === 'section')
    const items = set.ops.filter((op) => op.op === 'createNode' && op.nodeType === 'item')
    expect(sections).toHaveLength(scenario.sections.length)
    expect(items).toHaveLength(scenario.sections.flatMap((section) => section.items).length)
    const prices = set.ops.filter((op) => op.op === 'setField' && op.fieldKey === 'price')
    expect(prices).toHaveLength(items.length)
    // Money is minor units from the catalogue, never recomputed (rule 8): the 8.05 craft beer.
    expect(
      prices.some(
        (op) => (op as unknown as { value: { amount_minor: number } }).value.amount_minor === 805,
      ),
    ).toBe(true)
  })

  it('has one item with required options, a sold-out item and no tip article on the menu', () => {
    const { set } = changeSet()
    const groups = set.ops.filter(
      (op) => op.op === 'createNode' && op.nodeType === 'modifier_group',
    )
    expect(groups).toHaveLength(1)
    const mins = set.ops.filter((op) => op.op === 'setField' && op.fieldKey === 'min')
    expect(mins.map((op) => (op as { value: unknown }).value)).toEqual([1])
    const notForSale = set.ops.filter(
      (op) => op.op === 'setField' && op.fieldKey === 'for_sale' && op.value === false,
    )
    expect(notForSale).toHaveLength(1)
    const names = JSON.stringify(set.ops)
    expect(names).not.toContain('"2999"')
  })

  it("links every node it creates, in the simulated POS's link types", () => {
    const { set } = changeSet()
    const links = set.ops.filter((op) => op.op === 'linkSource')
    const created = set.ops.filter((op) => op.op === 'createNode')
    expect(links).toHaveLength(created.length)
    const types = new Set(
      links.map((op) => (op as { link: { externalType: string } }).link.externalType),
    )
    expect([...types].sort()).toEqual(['article', 'category', 'option', 'option_group'])
  })
})
