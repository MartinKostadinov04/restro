// What a saved Style carries (D128, D129): everything but the venue's colours, Advanced roles, logo
// and body font. These are pure rules, so they are tested without a database or a screen.
import { describe, expect, it } from 'vitest'

import type { DesignChoiceOption, DesignPage } from './contract'
import { DESIGN_PAGES } from './contract'
import { BASIC_DESIGN_VALUES } from './record'
import {
  designValuesOfStyle,
  SAVED_STYLE_NAME_MAX,
  SavedStyleContentSchema,
  SavedStyleNameSchema,
  sameStyle,
  styleNameKey,
  styleValuesOf,
} from './saved-style'
import { DesignValuesSchema } from './schema'

/** Every choice option of the contract the brand owns (the body font, D128). */
const BRAND_OPTIONS = (DESIGN_PAGES as readonly DesignPage[]).flatMap((page) =>
  page.options.flatMap((option) =>
    option.kind === 'choice' && (option as DesignChoiceOption).brand === true
      ? [[page.id, option.id]]
      : [],
  ),
)

const club = DesignValuesSchema.parse({
  ...BASIC_DESIGN_VALUES,
  general: { ...BASIC_DESIGN_VALUES.general, body_font: 'unbounded', screen: 'dark' },
})

describe('a saved Style’s values', () => {
  it('is the contract’s body font and nothing else that a Style leaves out', () => {
    expect(BRAND_OPTIONS).toEqual([['general', 'body_font']])
  })

  it('drops the body font and keeps every other option', () => {
    const style = styleValuesOf(club) as unknown as Record<string, Record<string, string>>
    expect(style.general?.body_font).toBeUndefined()
    expect(style.general?.screen).toBe('dark')
    for (const [page, options] of Object.entries(
      club as unknown as Record<string, Record<string, string>>,
    )) {
      for (const [option, value] of Object.entries(options)) {
        if (page === 'general' && option === 'body_font') continue
        expect(style[page]?.[option], `${page}.${option}`).toBe(value)
      }
    }
  })

  it('puts the reading venue’s own body font back, never the saving venue’s', () => {
    const applied = designValuesOfStyle(styleValuesOf(club), 'lora')
    expect(applied.general.body_font).toBe('lora')
    expect(applied.general.screen).toBe('dark')
    // The whole result is a design's values again: every option the renderer needs is there.
    expect(DesignValuesSchema.safeParse(applied).success).toBe(true)
  })

  it('round-trips a design’s values but the body font', () => {
    expect(designValuesOfStyle(styleValuesOf(club), club.general.body_font)).toEqual(club)
  })
})

describe('a saved Style’s name', () => {
  it('is trimmed, and 1 to the maximum characters', () => {
    expect(SavedStyleNameSchema.parse('  Club night  ')).toBe('Club night')
    expect(SavedStyleNameSchema.safeParse('   ').success).toBe(false)
    expect(SavedStyleNameSchema.safeParse('x'.repeat(SAVED_STYLE_NAME_MAX)).success).toBe(true)
    expect(SavedStyleNameSchema.safeParse('x'.repeat(SAVED_STYLE_NAME_MAX + 1)).success).toBe(false)
  })

  it('is compared without case or surrounding space, in Bulgarian too', () => {
    expect(styleNameKey(' Клуб ')).toBe(styleNameKey('КЛУБ'))
    expect(styleNameKey('Club')).toBe(styleNameKey('club'))
    expect(styleNameKey('Клуб')).not.toBe(styleNameKey('Клубът'))
  })
})

describe('a saved Style as stored', () => {
  const content = SavedStyleContentSchema.parse({
    name: 'Club night',
    style: 'club',
    values: styleValuesOf(club),
  })

  it('takes a name, the premade Style it came from and the Style’s values', () => {
    expect(SavedStyleContentSchema.parse({ ...content, name: ' Club night ' })).toEqual(content)
  })

  it('refuses a design’s values (the body font is the venue’s)', () => {
    expect(SavedStyleContentSchema.safeParse({ ...content, values: club }).success).toBe(false)
  })

  it('refuses a Style that is not one of Restro’s', () => {
    expect(SavedStyleContentSchema.safeParse({ ...content, style: 'made-up' }).success).toBe(false)
  })

  it('tells one Style from another by its name and its values', () => {
    expect(sameStyle(content, { ...content })).toBe(true)
    expect(sameStyle(content, { ...content, name: 'Club nights' })).toBe(false)
    expect(
      sameStyle(content, {
        ...content,
        values: styleValuesOf(
          DesignValuesSchema.parse({
            ...club,
            general: { ...club.general, screen: 'light' },
          }),
        ),
      }),
    ).toBe(false)
  })
})
