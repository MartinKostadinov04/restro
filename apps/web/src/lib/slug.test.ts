import { isVenueSlug } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { MAX_SUGGESTED_SLUG_LENGTH, suggestSlug } from './slug'

describe('suggestSlug', () => {
  it('transliterates Bulgarian and keeps Latin words', () => {
    expect(suggestSlug('Демо Клуб Sofia')).toBe('demo-klub-sofia')
  })

  it('uses the official Bulgarian scheme for every letter', () => {
    const alphabet = 'абвгдежзийклмнопрстуфхцчшщъьюя'
    const expected = [
      'a',
      'b',
      'v',
      'g',
      'd',
      'e',
      'zh',
      'z',
      'i',
      'y',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
      'r',
      's',
      't',
      'u',
      'f',
      'h',
      'ts',
      'ch',
      'sh',
      'sht',
      'a',
      'y',
      'yu',
      'ya',
    ].join('')
    expect(suggestSlug(alphabet)).toBe(expected)
    expect(suggestSlug(alphabet.toUpperCase())).toBe(expected)
  })

  it('turns every other run of characters into one hyphen and trims the ends', () => {
    expect(suggestSlug('  Bar & Dinner!!  ')).toBe('bar-dinner')
    expect(suggestSlug('Club__No.  1')).toBe('club-no-1')
    expect(suggestSlug('--Луна--')).toBe('luna')
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(suggestSlug('  --  ')).toBe('')
    expect(suggestSlug('')).toBe('')
    expect(suggestSlug('!!!')).toBe('')
    expect(suggestSlug('日本語')).toBe('')
  })

  it('cuts at 60 characters and never ends in a hyphen', () => {
    const long = suggestSlug('a'.repeat(80))
    expect(long).toBe('a'.repeat(MAX_SUGGESTED_SLUG_LENGTH))
    // The 60th character is a separator: the cut must not leave it behind.
    const name = `${'b'.repeat(59)} ${'c'.repeat(10)}`
    const cut = suggestSlug(name)
    expect(cut).toBe('b'.repeat(59))
    expect(cut.endsWith('-')).toBe(false)
  })

  it('always gives either nothing or a slug core accepts', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (name) => {
        const slug = suggestSlug(name)
        expect(slug === '' || isVenueSlug(slug)).toBe(true)
        expect(slug.length).toBeLessThanOrEqual(MAX_SUGGESTED_SLUG_LENGTH)
      }),
    )
  })
})
