// Pricing a Send's lines (#77): integer minor units through `money` (rule 8), and nothing the guest
// could not order is ever priced (rule 5). Also the reference a waiter reads.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { drawReference, REFERENCE_ALPHABET } from './send'
import { priceSentLines, requiresOptions, type SendMenu, type SendMenuItem } from './send-menu'

const beer = newId('nd')
const gin = newId('nd')
const lime = newId('nd')
const cola = newId('nd')
const card = newId('nd')

const item = (priceMinor: number | null, extra: Partial<SendMenuItem> = {}): SendMenuItem => ({
  priceMinor,
  orderable: true,
  soldOut: false,
  name: 'Item',
  options: new Map(),
  ...extra,
})

const menu: SendMenu = {
  currency: 'EUR',
  items: new Map([
    [beer, item(450, { name: 'Beer' })],
    [gin, item(700, { name: 'Gin', options: new Map([[lime, { deltaMinor: 50, name: 'Lime' }]]) })],
    [cola, item(300, { soldOut: true })],
    [card, item(null, { orderable: false })],
  ]),
}

describe('priceSentLines (#77)', () => {
  it('prices each line as its item plus its options, times its quantity', () => {
    expect(
      priceSentLines(menu, [
        { itemId: beer, optionIds: [], qty: 3 },
        { itemId: gin, optionIds: [lime], qty: 2 },
      ]),
    ).toEqual({
      ok: true,
      totalMinor: 1350 + 1500,
      lines: [
        { unitMinor: 450, totalMinor: 1350, name: 'Beer', optionNames: [] },
        { unitMinor: 750, totalMinor: 1500, name: 'Gin', optionNames: ['Lime'] },
      ],
    })
  })

  it('refuses an item that is gone, sold out, not orderable, or an option it does not have', () => {
    const refused = (itemId: string) => ({ ok: false, code: 'item_unavailable', itemId })
    const gone = newId('nd')
    expect(priceSentLines(menu, [{ itemId: gone, optionIds: [], qty: 1 }])).toEqual(refused(gone))
    expect(priceSentLines(menu, [{ itemId: cola, optionIds: [], qty: 1 }])).toEqual(refused(cola))
    expect(priceSentLines(menu, [{ itemId: card, optionIds: [], qty: 1 }])).toEqual(refused(card))
    expect(priceSentLines(menu, [{ itemId: beer, optionIds: [lime], qty: 1 }])).toEqual(
      refused(beer),
    )
  })

  it('keeps the total an integer sum of the lines, and never prices what a guest could not order', () => {
    const ids = [beer, gin, cola, card]
    const line = fc.record({
      itemId: fc.constantFrom(...ids),
      withLime: fc.boolean(),
      qty: fc.integer({ min: 1, max: 99 }),
    })
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 12 }), (drawn) => {
        const lines = drawn.map(({ itemId, withLime, qty }) => ({
          itemId,
          optionIds: withLime && itemId === gin ? [lime] : [],
          qty,
        }))
        const priced = priceSentLines(menu, lines)
        const blocked = lines.find((one) => one.itemId === cola || one.itemId === card)
        if (blocked !== undefined) {
          expect(priced).toMatchObject({ ok: false, itemId: blocked.itemId })
          return
        }
        if (!priced.ok) throw new Error('expected a price')
        expect(Number.isInteger(priced.totalMinor)).toBe(true)
        expect(priced.totalMinor).toBe(priced.lines.reduce((sum, one) => sum + one.totalMinor, 0))
        priced.lines.forEach((one, index) => {
          expect(one.totalMinor).toBe(one.unitMinor * (lines[index]?.qty ?? 0))
        })
      }),
    )
  })
})

describe('drawReference (#77)', () => {
  it('draws from letters and digits a waiter cannot confuse', () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[0O1IL2Z5S8BG]/)
    for (let i = 0; i < 200; i++) expect(drawReference()).toMatch(/^[ACDEFHJKMNPQRTUVWXY34679]{3}$/)
    expect(drawReference(4)).toHaveLength(4)
  })
})

describe('requiresOptions (#78)', () => {
  it('is true only where a group of the item asks for a choice', () => {
    const groups = { size: { min: 1 }, extras: { min: 0 } }
    expect(requiresOptions(['extras', 'size'], groups)).toBe(true)
    expect(requiresOptions(['extras'], groups)).toBe(false)
    expect(requiresOptions(['gone'], groups)).toBe(false)
    expect(requiresOptions([], groups)).toBe(false)
  })
})
