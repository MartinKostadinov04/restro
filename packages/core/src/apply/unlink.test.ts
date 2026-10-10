import { describe, expect, it } from 'vitest'

import { findField } from '../template'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { unlinkCopy } from './unlink'

function field(nodeType: 'item' | 'section', key: string) {
  const definition = findField(VENUE_MENU_TEMPLATE, nodeType, key)
  if (!definition) throw new Error(key)
  return definition
}

const price = (amount: number) => ({ amount_minor: amount, currency: 'EUR' })

describe('unlinkCopy: what the manual layer keeps when the barsy rows go', () => {
  it('copies barsy-ranked values over manual (source_first, locked)', () => {
    expect(unlinkCopy(field('item', 'price'), { barsy: [price(1250)] })).toEqual({
      value: price(1250),
    })
    expect(
      unlinkCopy(field('item', 'portion'), {
        barsy: [{ value: 250, unit: 'ml' }],
        manual: { value: 300, unit: 'ml' },
      }),
    ).toEqual({ value: { value: 250, unit: 'ml' } })
  })

  it('merges localized text per locale: barsy’s locales win, ours are kept', () => {
    expect(
      unlinkCopy(field('item', 'name'), {
        barsy: [{ bg_BG: 'Негрони', en_US: 'Negroni' }],
        manual: { de_DE: 'Negroni (DE)', en_US: 'old' },
      }),
    ).toEqual({ value: { de_DE: 'Negroni (DE)', en_US: 'Negroni', bg_BG: 'Негрони' } })
  })

  it('treats barsy as the fallback of builder-owned fields', () => {
    const description = field('item', 'description')
    expect(
      unlinkCopy(description, { barsy: [{ en_US: 'From barsy' }], manual: { en_US: 'Ours' } }),
    ).toBeNull()
    expect(
      unlinkCopy(description, {
        barsy: [{ en_US: 'From barsy', bg_BG: 'От barsy' }],
        manual: { en_US: 'Ours' },
      }),
    ).toEqual({ value: { en_US: 'Ours', bg_BG: 'От barsy' } })
    expect(unlinkCopy(description, { barsy: [{ en_US: 'x' }], import: { en_US: 'y' } })).toBeNull()
    expect(unlinkCopy(field('item', 'image'), { barsy: [{ asset_id: 'as_1' }] })).toEqual({
      value: { asset_id: 'as_1' },
    })
  })

  it('carries over only a barsy false of an all_true flag (rule 5)', () => {
    const forSale = field('item', 'for_sale')
    expect(unlinkCopy(forSale, { barsy: [true] })).toBeNull()
    expect(unlinkCopy(forSale, { barsy: [false] })).toEqual({ value: false })
    expect(unlinkCopy(forSale, { barsy: [true, false] })).toEqual({ value: false })
    expect(unlinkCopy(forSale, { barsy: [false], manual: false })).toBeNull()
  })

  it('unions sets, and declares the union of disagreeing allergen sets', () => {
    expect(
      unlinkCopy(field('item', 'tags'), { barsy: [['new', 'signature']], manual: ['house'] }),
    ).toEqual({ value: ['house', 'new', 'signature'] })
    expect(unlinkCopy(field('item', 'tags'), { barsy: [['a']], manual: ['a'] })).toBeNull()
    expect(
      unlinkCopy(field('item', 'allergens'), { barsy: [['milk']], manual: ['gluten'] }),
    ).toEqual({ value: ['gluten', 'milk'] })
    expect(
      unlinkCopy(field('item', 'allergens'), {
        barsy: [['milk', 'gluten']],
        manual: ['gluten', 'milk'],
      }),
    ).toBeNull()
  })

  it('copies nothing when venue scopes disagree (no hand price rather than a wrong one)', () => {
    expect(unlinkCopy(field('item', 'price'), { barsy: [price(1250), price(1300)] })).toBeNull()
    expect(unlinkCopy(field('item', 'price'), { barsy: [price(1250), price(1250)] })).toEqual({
      value: price(1250),
    })
    expect(unlinkCopy(field('item', 'price'), { barsy: [] })).toBeNull()
  })

  it('writes nothing when manual already holds the value', () => {
    expect(
      unlinkCopy(field('section', 'title'), {
        barsy: [{ en_US: 'Bar' }],
        manual: { en_US: 'Bar' },
      }),
    ).toBeNull()
  })
})
