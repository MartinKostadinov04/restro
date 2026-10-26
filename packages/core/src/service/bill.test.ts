import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { isId, type NodeId, newId } from '../ids'
import {
  billBackendValues,
  billIdOf,
  billLineIdOf,
  billView,
  checkBillIdKey,
  FRESH_READING_MS,
  forbiddenPaths,
  type LineItem,
  parseStoredBills,
  type ReadBill,
  ReadBillSchema,
  sittingEndsByReading,
  storedBills,
  wantsFreshReading,
} from './bill'

const key = 'k'.repeat(40)
const tenantId = newId('tn')

function bill(input: {
  pos: string
  totalMinor: number
  paidMinor?: number
  lines: {
    pos: string
    item: string | null
    name: string | null
    quantity: string
    amountMinor: number
    restroRef?: string
  }[]
}): ReadBill {
  return ReadBillSchema.parse({
    pos: input.pos,
    totalMinor: input.totalMinor,
    paidMinor: input.paidMinor ?? 0,
    openedAt: '2026-10-26T20:00:00.000Z',
    openedByRestro: false,
    paymentInFlight: false,
    lines: input.lines.map((line) => ({
      pos: line.pos,
      itemPos: line.item,
      posName: line.name,
      quantity: line.quantity,
      amountMinor: line.amountMinor,
      enteredBy: 'staff',
      enteredAt: null,
      restroRef: line.restroRef ?? null,
    })),
  })
}

describe('bill ids', () => {
  it('are stable, of their kind, and different per tenant, bill and line', () => {
    const id = billIdOf(key, tenantId, '7001')
    expect(isId('rd', id)).toBe(true)
    expect(billIdOf(key, tenantId, '7001')).toBe(id)
    expect(billIdOf(key, newId('tn'), '7001')).not.toBe(id)
    expect(billIdOf(key, tenantId, '7002')).not.toBe(id)
    expect(billIdOf('j'.repeat(40), tenantId, '7001')).not.toBe(id)

    const line = billLineIdOf(key, tenantId, '7001', '1')
    expect(isId('bn', line)).toBe(true)
    expect(billLineIdOf(key, tenantId, '7001', '1')).toBe(line)
    expect(billLineIdOf(key, tenantId, '7002', '1')).not.toBe(line)
    // Length-prefixed parts: "70" + "011" is not "700" + "11".
    expect(billLineIdOf(key, tenantId, '70', '011')).not.toBe(
      billLineIdOf(key, tenantId, '700', '11'),
    )
  })

  it('say nothing of the POS id they come from', () => {
    for (const pos of ['7001', '42', 'abc']) expect(billIdOf(key, tenantId, pos)).not.toContain(pos)
  })

  it('refuse a short key', () => {
    expect(() => checkBillIdKey('short')).toThrow(/32/)
    expect(() => billIdOf(`${' '.repeat(31)}x`, tenantId, '1')).toThrow()
    expect(checkBillIdKey(key)).toBe(key)
  })
})

describe('storedBills and billView', () => {
  const beer = newId('nd') as NodeId
  const items = new Map<string, LineItem>([
    ['501', { itemId: beer, name: { bg_BG: 'Бира', en_US: 'Beer' } }],
  ])
  const reading = [
    bill({
      pos: '7001',
      totalMinor: 900,
      paidMinor: 200,
      lines: [
        {
          pos: '11',
          item: '501',
          name: 'Бира Каменица',
          quantity: '2',
          amountMinor: 1000,
          restroRef: 'so_ref_1',
        },
        { pos: '12', item: '999', name: 'Мезе', quantity: '0.5', amountMinor: 300 },
        { pos: '13', item: null, name: 'Отстъпка', quantity: '1', amountMinor: -400 },
        { pos: '1', item: '501', name: 'Бира Каменица', quantity: '1', amountMinor: 0 },
      ],
    }),
  ]
  const stored = storedBills({
    key,
    tenantId,
    currency: 'EUR',
    bills: reading,
    itemOf: (pos) => items.get(pos),
  })
  const view = billView({ readAt: new Date('2026-10-26T21:00:00Z'), complete: true, bills: stored })

  it('names a line from our item, else leaves it for "Other item"', () => {
    const [part] = view.bills
    expect(part?.lines.map((line) => line.name)).toEqual([
      { bg_BG: 'Бира', en_US: 'Beer' },
      null,
      null,
      { bg_BG: 'Бира', en_US: 'Beer' },
    ])
    expect(stored[0]?.lines[0]?.itemId).toBe(beer)
    expect(stored[0]?.lines[1]?.itemId).toBeNull()
  })

  it('shows quantities and signed amounts as the POS gives them, discounts and free lines too', () => {
    const lines = view.bills[0]?.lines ?? []
    expect(lines.map((line) => [line.quantity, line.amountMinor])).toEqual([
      ['2', 1000],
      ['0.5', 300],
      ['1', -400],
      ['1', 0],
    ])
    // The POS's own total, not the sum of its lines.
    expect(view).toMatchObject({ currency: 'EUR', totalMinor: 900, paidMinor: 200, owedMinor: 700 })
  })

  it('shows nothing backend and nothing that marks a line as from the phones', () => {
    const forbidden = billBackendValues(stored)
    for (const value of ['7001', '11', '12', '13', '501', '999', 'Мезе', 'Отстъпка', 'so_ref_1']) {
      expect(forbidden.has(value), value).toBe(true)
    }
    // Line "1" reads like a quantity shown anyway, and the till's text like our name.
    expect(forbidden.has('1')).toBe(false)
    expect(forbiddenPaths(view, forbidden)).toEqual([])
    // `beingPaid` says only that a payment holds the line (#110): no payer, amount or timer.
    expect(Object.keys(view.bills[0]?.lines[0] ?? {}).sort()).toEqual([
      'amountMinor',
      'beingPaid',
      'id',
      'name',
      'quantity',
    ])
    // The walk finds a leak, by place.
    expect(forbiddenPaths({ lines: [{ note: '501' }] }, forbidden)).toEqual(['$.lines[0].note'])
    expect(forbiddenPaths({ '7001': 1 }, forbidden)).toEqual(['$.<key>'])
  })

  it('reads back what it stored, and a row that no longer parses as no bill', () => {
    expect(parseStoredBills(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
    expect(parseStoredBills([{ id: 'nope' }])).toEqual([])
    expect(parseStoredBills(null)).toEqual([])
  })

  it('property: for any reading, the view holds no backend value (rule 3)', () => {
    const posId = fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/)
    const line = fc.record({
      pos: posId,
      item: fc.option(posId, { nil: null }),
      name: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
      quantity: fc.constantFrom('1', '2', '0.5', '-1', '3.25'),
      amountMinor: fc.integer({ min: -10_000, max: 10_000 }),
      restroRef: fc.option(posId, { nil: undefined }),
    })
    const bills = fc.uniqueArray(
      fc.record({
        pos: posId,
        totalMinor: fc.integer({ min: -10_000, max: 50_000 }),
        lines: fc.uniqueArray(line, { selector: (l) => l.pos, maxLength: 6 }),
      }),
      { selector: (b) => b.pos, maxLength: 3 },
    )
    fc.assert(
      fc.property(bills, fc.boolean(), (input, linked) => {
        const stored = storedBills({
          key,
          tenantId,
          currency: 'EUR',
          bills: input.map((b) => bill(b)),
          itemOf: (pos) =>
            linked ? { itemId: newId('nd'), name: { bg_BG: `Ястие ${pos.length}` } } : undefined,
        })
        const view = billView({ readAt: new Date(), complete: true, bills: stored })
        expect(forbiddenPaths(view, billBackendValues(stored))).toEqual([])
      }),
    )
  })
})

describe('sittingEndsByReading', () => {
  const empty = { lines: [] }
  const held = { lines: [{}] }
  const ends = (facts: Partial<Parameters<typeof sittingEndsByReading>[0]>) =>
    sittingEndsByReading({
      complete: true,
      hadBillLines: true,
      bills: [],
      onPaymentTable: false,
      ...facts,
    })

  it('ends when a complete reading shows the bills gone or empty after they held lines', () => {
    expect(ends({ bills: [] })).toBe(true)
    expect(ends({ bills: [empty, empty] })).toBe(true)
  })

  it('does not end while a bill holds lines, for a table opened bare, on a partial reading, or on a payment table', () => {
    expect(ends({ bills: [empty, held] })).toBe(false)
    expect(ends({ hadBillLines: false })).toBe(false)
    expect(ends({ complete: false })).toBe(false)
    expect(ends({ onPaymentTable: true })).toBe(false)
  })
})

describe('wantsFreshReading', () => {
  it('reads again when there is no reading or it is older than 15 s (D111)', () => {
    const now = new Date('2026-10-26T21:00:00Z')
    expect(wantsFreshReading(null, now)).toBe(true)
    expect(wantsFreshReading(new Date(now.getTime() - FRESH_READING_MS), now)).toBe(false)
    expect(wantsFreshReading(new Date(now.getTime() - FRESH_READING_MS - 1), now)).toBe(true)
    expect(wantsFreshReading(now, now)).toBe(false)
  })
})
