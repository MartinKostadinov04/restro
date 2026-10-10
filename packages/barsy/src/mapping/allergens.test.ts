import { ALLERGENS } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { findAllergenKey, parseAllergenText } from './allergens.ts'
import { demoDetailsTree } from './test-data.ts'

describe('parseAllergenText', () => {
  it('reads Bulgarian and English words, in any case, separated by commas, semicolons, "и" or "and"', () => {
    expect(parseAllergenText('Глутен, МЛЯКО и яйца; Soy and Fish')).toStrictEqual({
      allergens: ['gluten', 'eggs', 'fish', 'soybeans', 'milk'],
      unknown: [],
    })
  })

  it('returns allergens in the order of the 14 EU codes, without repeats', () => {
    const { allergens } = parseAllergenText('milk, мляко, Lactose, gluten, wheat')
    expect(allergens).toStrictEqual(['gluten', 'milk'])
  })

  it('reads the official wording and labels around the words', () => {
    expect(
      parseAllergenText(
        'Алергени: житни култури, съдържащи глутен (пшеница, ръж); мляко и продукти на негова основа (включително лактоза); серен диоксид и сулфити',
      ),
    ).toStrictEqual({ allergens: ['gluten', 'milk', 'sulphites'], unknown: [] })
    expect(
      parseAllergenText('Contains: tree nuts (almonds, шам фъстък), peanuts, E221').allergens,
    ).toStrictEqual(['peanuts', 'nuts', 'sulphites'])
  })

  it('maps phrases before their words: "шам фъстък" is a nut, "фъстъци" are peanuts', () => {
    expect(parseAllergenText('шам фъстък').allergens).toStrictEqual(['nuts'])
    expect(parseAllergenText('фъстъци').allergens).toStrictEqual(['peanuts'])
  })

  it('shellfish names crustaceans and molluscs', () => {
    expect(parseAllergenText('shellfish').allergens).toStrictEqual(['crustaceans', 'molluscs'])
  })

  it('never guesses: unknown words and numbers are reported, in order, once', () => {
    expect(parseAllergenText('глутен, 1, 7, xyzzy, 1, млечко')).toStrictEqual({
      allergens: ['gluten'],
      unknown: ['1', '7', 'xyzzy', 'млечко'],
    })
  })

  it('a negation is never read as the allergen it negates', () => {
    expect(parseAllergenText('без глутен')).toStrictEqual({
      allergens: [],
      unknown: ['без глутен'],
    })
    expect(parseAllergenText('lactose free, milk')).toStrictEqual({
      allergens: ['milk'],
      unknown: ['lactose free'],
    })
    expect(parseAllergenText('безглутенов хляб').allergens).toStrictEqual([])
  })

  it('empty or label-only text names nothing', () => {
    expect(parseAllergenText('')).toStrictEqual({ allergens: [], unknown: [] })
    expect(parseAllergenText(' Алергени: ')).toStrictEqual({ allergens: [], unknown: [] })
  })

  it('only ever returns codes of the 14 EU allergens, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (text) => {
        const { allergens, unknown } = parseAllergenText(text)
        expect(allergens.every((code) => (ALLERGENS as readonly string[]).includes(code))).toBe(
          true,
        )
        expect(new Set(allergens).size).toBe(allergens.length)
        expect(new Set(unknown).size).toBe(unknown.length)
      }),
      { numRuns: 200 },
    )
  })
})

describe('findAllergenKey', () => {
  it('finds "Алергени" in the demo characteristic tree: k102', () => {
    expect(findAllergenKey(demoDetailsTree, undefined)).toStrictEqual({
      key: 'k102',
      ambiguous: false,
      candidates: ['k102'],
    })
  })

  it('matches "Allergens" in any case, flags several matches, and lets the configuration win', () => {
    const tree = [
      {
        group_id: 1,
        group_name: 'Main',
        details: {
          k9: { detail_name: ' ALLERGENS ' },
          k3: { detail_name: 'allergens' },
          k5: { detail_name: 'Калории' },
        },
      },
    ]
    expect(findAllergenKey(tree, undefined)).toStrictEqual({
      key: 'k3',
      ambiguous: true,
      candidates: ['k3', 'k9'],
    })
    expect(findAllergenKey(tree, 'k5').key).toBe('k5')
    expect(findAllergenKey([], undefined).key).toBeNull()
  })
})
