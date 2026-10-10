import { describe, expect, it } from 'vitest'

import {
  checkTagLabel,
  DEFAULT_TAG_COLOR,
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  TagColorSchema,
} from './tags'

const languages = { defaultLocale: 'bg_BG', enabledLocales: ['bg_BG', 'en_US'] } as const

describe('tag colours', () => {
  it('are token names, never raw colours, and the default is one of them', () => {
    expect(TAG_COLORS).toContain(DEFAULT_TAG_COLOR)
    for (const color of TAG_COLORS) expect(color).toMatch(/^[a-z][a-z_]*$/)
    expect(TagColorSchema.safeParse('#ff0000').success).toBe(false)
    expect(TagColorSchema.safeParse('red').success).toBe(false)
    expect(TagColorSchema.safeParse('accent').success).toBe(true)
  })
})

describe('checkTagLabel', () => {
  it('trims the name and accepts the default language alone or with another enabled one', () => {
    expect(checkTagLabel({ bg_BG: '  Люто ' }, languages)).toEqual({
      ok: true,
      label: { bg_BG: 'Люто' },
    })
    expect(checkTagLabel({ bg_BG: 'Люто', en_US: 'Spicy' }, languages)).toMatchObject({ ok: true })
  })

  it('needs a name in the default language', () => {
    expect(checkTagLabel({ en_US: 'Spicy' }, languages)).toMatchObject({
      ok: false,
      problem: 'default_language_missing',
    })
  })

  it('refuses a language the venue has not enabled', () => {
    expect(checkTagLabel({ bg_BG: 'Люто', de_DE: 'Scharf' }, languages)).toMatchObject({
      ok: false,
      problem: 'language_not_enabled',
    })
  })

  it.each([
    ['nothing', undefined],
    ['an empty object', {}],
    ['a blank name', { bg_BG: '   ' }],
    ['a name that is too long', { bg_BG: 'x'.repeat(MAX_TAG_NAME_LENGTH + 1) }],
    ['an unknown language', { xx_XX: 'Люто', bg_BG: 'Люто' }],
    ['a string', 'Люто'],
  ])('refuses %s', (_label, value) => {
    expect(checkTagLabel(value, languages)).toMatchObject({ ok: false, problem: 'invalid' })
  })
})
