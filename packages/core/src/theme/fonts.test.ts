// The short font list (brief SH-01 §7, D70): six families with Cyrillic letters.
import { describe, expect, it } from 'vitest'

import { DESIGN_PAGES } from '../design/contract'
import { SnapshotThemeSchema } from '../snapshot/schema'
import { DEFAULT_FONT_ID, fontFamilyOf, THEME_FONTS } from './fonts'

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
  })

  it('takes its ids, in order, from the design contract’s Body font values', () => {
    const body = DESIGN_PAGES[0].options.find((option) => option.id === 'body_font')
    const ids = body?.kind === 'choice' ? body.values.map((value) => value.id) : []
    expect(THEME_FONTS.map((font) => font.id)).toEqual(ids)
    expect(ids[0]).toBe(DEFAULT_FONT_ID)
  })

  it('has unique kebab-case ids and families the snapshot accepts', () => {
    expect(new Set(THEME_FONTS.map((font) => font.id)).size).toBe(THEME_FONTS.length)
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
