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

describe('unlinkCopy: what the manual layer keeps when the till rows go', () => {
  it('copies till-ranked values over manual (source_first, locked)', () => {
    expect(unlinkCopy(field('item', 'price'), { till: [price(1250)] })).toEqual({
      value: price(1250),
    })
    expect(
      unlinkCopy(field('item', 'portion'), {
        till: [{ value: 250, unit: 'ml' }],
        manual: { value: 300, unit: 'ml' },
      }),
    ).toEqual({ value: { value: 250, unit: 'ml' } })
  })

  it('merges localized text per locale: till’s locales win, ours are kept', () => {
    expect(
      unlinkCopy(field('item', 'name'), {
        till: [{ bg_BG: 'Негрони', en_US: 'Negroni' }],
        manual: { de_DE: 'Negroni (DE)', en_US: 'old' },
      }),
    ).toEqual({ value: { de_DE: 'Negroni (DE)', en_US: 'Negroni', bg_BG: 'Негрони' } })
  })

  it('treats the till as the fallback of builder-owned fields', () => {
    const description = field('item', 'description')
    expect(
      unlinkCopy(description, { till: [{ en_US: 'From the till' }], manual: { en_US: 'Ours' } }),
    ).toBeNull()
    expect(
      unlinkCopy(description, {
        till: [{ en_US: 'From the till', bg_BG: 'От касата' }],
        manual: { en_US: 'Ours' },
      }),
    ).toEqual({ value: { en_US: 'Ours', bg_BG: 'От касата' } })
    expect(unlinkCopy(description, { till: [{ en_US: 'x' }] })).toEqual({ value: { en_US: 'x' } })
    expect(unlinkCopy(field('item', 'image'), { till: [{ asset_id: 'as_1' }] })).toEqual({
      value: { asset_id: 'as_1' },
    })
  })

  it('carries over only a till false of an all_true flag (rule 5)', () => {
    const forSale = field('item', 'for_sale')
    expect(unlinkCopy(forSale, { till: [true] })).toBeNull()
    expect(unlinkCopy(forSale, { till: [false] })).toEqual({ value: false })
    expect(unlinkCopy(forSale, { till: [true, false] })).toEqual({ value: false })
    expect(unlinkCopy(forSale, { till: [false], manual: false })).toBeNull()
  })

  it('unions sets, and declares the union of disagreeing allergen sets', () => {
    expect(
      unlinkCopy(field('item', 'tags'), { till: [['new', 'signature']], manual: ['house'] }),
    ).toEqual({ value: ['house', 'new', 'signature'] })
    expect(unlinkCopy(field('item', 'tags'), { till: [['a']], manual: ['a'] })).toBeNull()
    expect(
      unlinkCopy(field('item', 'allergens'), { till: [['milk']], manual: ['gluten'] }),
    ).toEqual({ value: ['gluten', 'milk'] })
    expect(
      unlinkCopy(field('item', 'allergens'), {
        till: [['milk', 'gluten']],
        manual: ['gluten', 'milk'],
      }),
    ).toBeNull()
  })

  it('copies nothing when venue scopes disagree (no hand price rather than a wrong one)', () => {
    expect(unlinkCopy(field('item', 'price'), { till: [price(1250), price(1300)] })).toBeNull()
    expect(unlinkCopy(field('item', 'price'), { till: [price(1250), price(1250)] })).toEqual({
      value: price(1250),
    })
    expect(unlinkCopy(field('item', 'price'), { till: [] })).toBeNull()
  })

  it('writes nothing when manual already holds the value', () => {
    expect(
      unlinkCopy(field('section', 'title'), {
        till: [{ en_US: 'Bar' }],
        manual: { en_US: 'Bar' },
      }),
    ).toBeNull()
  })
})
