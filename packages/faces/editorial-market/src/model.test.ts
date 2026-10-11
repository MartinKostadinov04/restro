import { resolveOptions } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import {
  assetUrl,
  bcp47,
  countVisible,
  faceOptions,
  hasVisibleItems,
  isFiltering,
  langOf,
  languageLabel,
  localeLang,
  matchesFilters,
  NO_FILTERS,
  photoSizes,
  themeVariables,
  toggled,
} from './model'
import { itemsOf, richView, SIGNATURE_TAG, SPICY_TAG } from './test-views'

describe('language tags', () => {
  it('writes the BCP 47 tag and sets lang only for a text that is not in the page language', () => {
    expect(bcp47('bg_BG')).toBe('bg-BG')
    expect(langOf({ text: 'x', lang: 'bg_BG' }, 'bg_BG')).toBeUndefined()
    expect(langOf({ text: 'x', lang: 'en_US' }, 'bg_BG')).toBe('en-US')
    expect(localeLang(null, 'bg_BG')).toBeUndefined()
    expect(localeLang('bg_BG', 'bg_BG')).toBeUndefined()
    expect(localeLang('de_DE', 'bg_BG')).toBe('de-DE')
    expect(languageLabel('bg_BG')).toBe('BG')
    expect(languageLabel('en_US')).toBe('EN')
  })
})

describe('asset addresses', () => {
  it('joins the base and the path with one slash', () => {
    expect(assetUrl('/cdn', '/a/as_x/w640.webp')).toBe('/cdn/a/as_x/w640.webp')
    expect(assetUrl('/cdn/', '/a/as_x/w640.webp')).toBe('/cdn/a/as_x/w640.webp')
    expect(assetUrl('https://cdn.test', 'a/as_x/w640.webp')).toBe(
      'https://cdn.test/a/as_x/w640.webp',
    )
  })
})

describe('the options', () => {
  // The face reads its options the way face.tsx does: the shell resolves them against the manifest.
  const read = (raw: unknown) => faceOptions(resolveOptions(EDITORIAL_MARKET_MANIFEST, raw))
  const DEFAULTS = { layout: 'two', layoutSwitch: true, featureFirstSection: true }

  it('has the defaults of the brief, which the manifest declares', () => {
    expect(read(undefined)).toEqual(DEFAULTS)
    expect(read({})).toEqual(DEFAULTS)
  })

  it('reads valid options', () => {
    expect(read({ layout: 'list', layoutSwitch: false, featureFirstSection: false })).toEqual({
      layout: 'list',
      layoutSwitch: false,
      featureFirstSection: false,
    })
    expect(read({ layout: 'one' }).layout).toBe('one')
  })

  it('falls back to the default for an unknown, missing or wrongly typed value', () => {
    expect(read({ layout: 'grid', layoutSwitch: 'yes', featureFirstSection: 'false' })).toEqual(
      DEFAULTS,
    )
    expect(read({ layout: true, layoutSwitch: 'false' })).toEqual(DEFAULTS)
    expect(read({ colour: 'red' })).toEqual(DEFAULTS)
  })

  it('keeps a layout that is not on the list out, whatever the host passes', () => {
    for (const layout of ['grid', 'Two', '', 'two ', 2, null, ['two']]) {
      expect(read({ layout }).layout, String(layout)).toBe('two')
    }
  })
})

describe('the filters', () => {
  const view = richView()
  const all = itemsOf(view)
  const names = (found: typeof all) => found.map((item) => item.name.text)

  it('combines dietary labels with AND', () => {
    const filters = { dietary: new Set(['vegan', 'gluten_free']), tags: new Set<string>() }
    expect(names(all.filter((item) => matchesFilters(item, filters)))).toEqual(['Hummus', 'Olives'])
    const none = { dietary: new Set(['vegan', 'vegetarian']), tags: new Set<string>() }
    expect(all.some((item) => matchesFilters(item, none))).toBe(false)
  })

  it('combines tags with OR', () => {
    const both = { dietary: new Set<string>(), tags: new Set([SIGNATURE_TAG, SPICY_TAG]) }
    expect(names(all.filter((item) => matchesFilters(item, both)))).toEqual([
      'Hummus',
      'Olives',
      'Halloumi',
      'Burger',
      'Steak',
    ])
    const one = { dietary: new Set<string>(), tags: new Set([SPICY_TAG]) }
    expect(names(all.filter((item) => matchesFilters(item, one)))).toEqual(['Olives', 'Steak'])
  })

  it('lets everything through when nothing is switched on', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false)
    expect(all.every((item) => matchesFilters(item, NO_FILTERS))).toBe(true)
    expect(countVisible(view.sections, NO_FILTERS)).toBe(all.length)
  })

  it('knows which sections still have something to show', () => {
    const signature = { dietary: new Set<string>(), tags: new Set([SIGNATURE_TAG]) }
    expect(view.sections.map((section) => hasVisibleItems(section, signature))).toEqual([
      true,
      true,
      false,
    ])
    expect(countVisible(view.sections, signature)).toBe(3)
  })

  it('toggles a key in a copy of the set', () => {
    const start = new Set(['a'])
    expect([...toggled(start, 'b')]).toEqual(['a', 'b'])
    expect([...toggled(start, 'a')]).toEqual([])
    expect([...start]).toEqual(['a'])
  })
})

describe('the theme as CSS variables', () => {
  const { theme } = richView()

  it('writes the eight colours for a light and for a dark screen', () => {
    const vars = themeVariables(theme)
    expect(vars['--rm-l-background']).toBe(theme.colors.background)
    expect(vars['--rm-l-onAccent']).toBe(theme.colors.onAccent)
    expect(vars['--rm-l-accentText']).toBe(theme.colors.accentText)
    expect(vars['--rm-d-background']).toBe(theme.colorsDark.background)
    expect(vars['--rm-d-border']).toBe(theme.colorsDark.border)
    expect(Object.keys(vars).filter((key) => key.startsWith('--rm-l-'))).toHaveLength(8)
    expect(Object.keys(vars).filter((key) => key.startsWith('--rm-d-'))).toHaveLength(8)
  })

  it('writes the radius and the shadow level', () => {
    expect(themeVariables(theme)['--rm-radius']).toBe(`${theme.radius}px`)
    expect(themeVariables({ ...theme, shadow: 3 })['--rm-shadow']).toBe('3')
    expect(themeVariables({ ...theme, shadow: 99 })['--rm-shadow']).toBe('5')
    expect(themeVariables({ ...theme, shadow: -2 })['--rm-shadow']).toBe('0')
    expect(themeVariables({ ...theme, shadow: Number.NaN })['--rm-shadow']).toBe('0')
  })

  it('uses the host font stack for a font it self-hosts, else the quoted name and system fonts', () => {
    const own = themeVariables(theme, { [theme.font]: 'var(--font-inter), sans-serif' })
    expect(own['--rm-font']).toBe('var(--font-inter), sans-serif')
    const fallback = themeVariables({ ...theme, font: 'Playfair Display' })['--rm-font']
    expect(fallback).toMatch(/^"Playfair Display", system-ui/)
  })
})

describe('the size of an item photo (SH-07)', () => {
  it('follows the layout: the column, half of it, a 96 px square, or a card of the strip', () => {
    expect(photoSizes('list', false)).toBe('96px')
    expect(photoSizes('one', false)).toContain('calc(100vw - 68px)')
    expect(photoSizes('two', false)).toContain('calc(50vw - 42px)')
    expect(photoSizes('two', true)).toContain('84vw')
    // The strip ignores the layout.
    expect(photoSizes('list', true)).toBe(photoSizes('two', true))
    expect(photoSizes('one', true)).toBe(photoSizes('two', true))
  })

  it('never claims a photo is the whole screen wide, so a phone is not sent the biggest file', () => {
    for (const layout of ['list', 'one', 'two'] as const) {
      for (const strip of [false, true])
        expect(photoSizes(layout, strip)).not.toMatch(/(^|[ (,])100vw(?!\s*-)/)
    }
  })
})
