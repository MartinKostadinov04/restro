// The short font list (brief SH-01 §7, D70): six families with Cyrillic letters.
import { describe, expect, it } from 'vitest'

import { SnapshotThemeSchema } from '../snapshot/schema'
import { DEFAULT_FONT_ID, fontFamilyOf, THEME_FONT_IDS, THEME_FONTS } from './fonts'

describe('THEME_FONTS', () => {
  it('is the six families of D70, the default first', () => {
    expect(THEME_FONTS.map(({ id, family, kind }) => `${id}/${family}/${kind}`)).toEqual([
      'inter/Inter/sans',
      'manrope/Manrope/sans',
      'montserrat/Montserrat/sans',
      'playfair-display/Playfair Display/serif',
      'lora/Lora/serif',
      'unbounded/Unbounded/display',
    ])
    expect(DEFAULT_FONT_ID).toBe('inter')
    expect(THEME_FONT_IDS).toEqual(THEME_FONTS.map((font) => font.id))
  })

  it('has unique kebab-case ids and families the snapshot accepts', () => {
    expect(new Set(THEME_FONT_IDS).size).toBe(THEME_FONTS.length)
    const theme = { palette: ['#ffffff'], radius: 8, shadow: 1, logo: null }
    for (const font of THEME_FONTS) {
      expect(font.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(SnapshotThemeSchema.safeParse({ ...theme, font: font.family }).success, font.id).toBe(
        true,
      )
    }
  })

  it('names the family of an id, and the default family for anything else', () => {
    expect(fontFamilyOf('playfair-display')).toBe('Playfair Display')
    expect(fontFamilyOf('comic-sans')).toBe('Inter')
    expect(fontFamilyOf(undefined)).toBe('Inter')
  })
})
