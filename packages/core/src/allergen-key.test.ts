import { describe, expect, it } from 'vitest'

import { isAllergenDetailName } from './allergen-key'

describe('isAllergenDetailName', () => {
  it('knows the Bulgarian and the English name, in any case', () => {
    expect(isAllergenDetailName('Алергени')).toBe(true)
    expect(isAllergenDetailName('алергени')).toBe(true)
    expect(isAllergenDetailName('АЛЕРГЕНИ')).toBe(true)
    expect(isAllergenDetailName('Allergens')).toBe(true)
    expect(isAllergenDetailName('allergens')).toBe(true)
  })

  it('ignores the spaces around the name', () => {
    expect(isAllergenDetailName('  Алергени ')).toBe(true)
    expect(isAllergenDetailName(' allergens\t')).toBe(true)
  })

  it('is not any other characteristic', () => {
    expect(isAllergenDetailName('Грамаж')).toBe(false)
    expect(isAllergenDetailName('Allergen')).toBe(false)
    expect(isAllergenDetailName('allergens extra')).toBe(false)
    expect(isAllergenDetailName('')).toBe(false)
  })
})
