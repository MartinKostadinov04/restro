import { describe, expect, it } from 'vitest'

import type { SentOrderView } from './services'
import { isOutOfStock, refusedOutOfStock } from './stock'
import type { ViewItem } from './view-model'

const MOJITO = `nd_${'0'.repeat(21)}1` as const
const NEGRONI = `nd_${'0'.repeat(21)}2` as const

const sent = (state: SentOrderView['state'], reason: string | null): SentOrderView => ({
  id: 'so_1',
  state,
  reason,
  ref: 'K7Q',
  lines: [
    { itemId: NEGRONI, optionIds: [], qty: 2 },
    { itemId: MOJITO, optionIds: [], qty: 1, outOfStock: true },
  ],
  sentAt: 0,
  sentClock: '19:42',
  mine: true,
})

describe('out of stock (#80)', () => {
  it('takes the flagged items of the newest sent order the POS refused for stock', () => {
    expect([...refusedOutOfStock([sent('not_sent', 'item_unavailable')])]).toEqual([MOJITO])
  })

  it('takes nothing from another outcome, an older order or no orders', () => {
    expect(refusedOutOfStock([sent('not_sent', 'ordering_paused')]).size).toBe(0)
    expect(refusedOutOfStock([sent('added', null)]).size).toBe(0)
    expect(
      refusedOutOfStock([sent('added', null), sent('not_sent', 'item_unavailable')]).size,
    ).toBe(0)
    expect(refusedOutOfStock().size).toBe(0)
  })

  it('is out when refused or sold out on the menu', () => {
    const soldOut = { state: { code: 'sold_out' } } as unknown as ViewItem
    const onSale = { state: { code: 'available' } } as unknown as ViewItem
    expect(isOutOfStock(MOJITO, onSale, new Set([MOJITO]))).toBe(true)
    expect(isOutOfStock(NEGRONI, soldOut, new Set())).toBe(true)
    expect(isOutOfStock(NEGRONI, onSale, new Set([MOJITO]))).toBe(false)
    expect(isOutOfStock(NEGRONI, undefined, new Set())).toBe(false)
  })
})
