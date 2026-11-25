import { describe, expect, it } from 'vitest'

import { type LinkedGroup, linkedGroupsOf } from './linked-group'
import { type GroupableSpot, outlinePad, planGroupsOf } from './plan-groups'

const hold = (tableId: string, reservationId: string) => ({
  tableId,
  sittingId: `st_${tableId}`,
  reservationId,
})

const spot = (id: string, tableId: string | null, ...parties: [string, string | null][]) =>
  ({
    id,
    table: tableId === null ? null : { id: tableId },
    holds: parties.map(([reservationId, name]) => ({ reservationId, name })),
  }) satisfies GroupableSpot

describe('planGroupsOf (D160 §1, #540)', () => {
  it('names a party on two spots or more, once, with its spots in the plan order', () => {
    const groups = linkedGroupsOf([
      hold('tb_1', 'rv_a'),
      hold('tb_2', 'rv_a'),
      hold('tb_3', 'rv_a'),
    ])
    const spots = [
      spot('sp_1', 'tb_1', ['rv_a', 'Иванова']),
      spot('sp_9', null),
      spot('sp_2', 'tb_2', ['rv_a', 'Иванова']),
      spot('sp_3', 'tb_3', ['rv_a', 'Иванова']),
    ]
    expect(planGroupsOf(groups, spots)).toEqual([
      { reservationId: 'rv_a', name: 'Иванова', spotIds: ['sp_1', 'sp_2', 'sp_3'] },
    ])
  })

  it('keeps two parties apart, each with its own name, and a walk-in nobody named has none', () => {
    const groups = linkedGroupsOf([
      hold('tb_1', 'rv_a'),
      hold('tb_2', 'rv_a'),
      hold('tb_3', 'rv_b'),
      hold('tb_4', 'rv_b'),
    ])
    const spots = [
      spot('sp_1', 'tb_1', ['rv_a', 'Иванова']),
      spot('sp_2', 'tb_2', ['rv_a', 'Иванова']),
      spot('sp_3', 'tb_3', ['rv_b', null]),
      spot('sp_4', 'tb_4', ['rv_b', null]),
    ]
    expect(planGroupsOf(groups, spots).map((one) => [one.reservationId, one.name])).toEqual([
      ['rv_a', 'Иванова'],
      ['rv_b', null],
    ])
  })

  it('draws nothing for a party with fewer than two spots on this plan', () => {
    const groups = linkedGroupsOf([hold('tb_1', 'rv_a'), hold('tb_2', 'rv_a')])
    // The second table's spot is on another plan: this one draws one spot of the party.
    expect(planGroupsOf(groups, [spot('sp_1', 'tb_1', ['rv_a', 'Иванова'])])).toEqual([])
    expect(planGroupsOf(new Map<string, LinkedGroup>(), [])).toEqual([])
  })

  it('leaves out a spot the party does not hold, even on a member table', () => {
    const groups = linkedGroupsOf([hold('tb_1', 'rv_a'), hold('tb_2', 'rv_a')])
    const spots = [
      spot('sp_1', 'tb_1', ['rv_a', 'Иванова']),
      spot('sp_2', 'tb_2', ['rv_a', 'Иванова']),
      spot('sp_3', 'tb_2'),
    ]
    expect(planGroupsOf(groups, spots)[0]?.spotIds).toEqual(['sp_1', 'sp_2'])
  })
})

describe('outlinePad', () => {
  it('is a share of the typical spot and never less than the plan margin', () => {
    expect(outlinePad([])).toBe(20)
    expect(outlinePad([{ width: 80, height: 80 }])).toBe(20)
    expect(outlinePad([{ width: 1000, height: 800 }])).toBe(96)
    expect(
      outlinePad([
        { width: 1000, height: 1000 },
        { width: 1000, height: 1000 },
        { width: 50, height: 50 },
      ]),
    ).toBe(120)
  })
})
