// The six fonts of the venues' look (src/fonts.ts). `next/font/google` is a stand-in here (see
// vitest.setup.ts) that keeps the options of each call, which is what these tests read: next/font
// takes its options from the call at build time, so the call is the contract.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { THEME_FONTS } from '@restro/core'
import * as google from 'next/font/google'
import { describe, expect, it, vi } from 'vitest'

import { FONT_STACKS, FONT_VARIABLES, plainFontStack } from './fonts'

/** The loader of each family, by the name next/font gives it (spaces become underscores). */
const LOADERS = {
  Inter: google.Inter,
  Manrope: google.Manrope,
  Montserrat: google.Montserrat,
  'Playfair Display': google.Playfair_Display,
  Lora: google.Lora,
  Unbounded: google.Unbounded,
} as const

/**
 * The options each loader was called with, read now: the calls happen when `./fonts` is first
 * imported (above), and a mock's record can be cleared before the first test runs.
 */
const CALLS = Object.fromEntries(
  Object.entries(LOADERS).map(([family, loader]) => [family, [...vi.mocked(loader).mock.calls]]),
) as unknown as Record<keyof typeof LOADERS, unknown[][]>

/** The options the family's loader was called with (exactly one call). */
function optionsOf(family: keyof typeof LOADERS): Record<string, unknown> {
  const calls = CALLS[family]
  expect(calls, `${family} is loaded once`).toHaveLength(1)
  return (calls[0]?.[0] ?? {}) as Record<string, unknown>
}

describe('the font loaders', () => {
  it('load every font of THEME_FONTS, and nothing else', () => {
    expect(Object.keys(LOADERS).sort()).toEqual(THEME_FONTS.map((font) => font.family).sort())
  })

  it.each(THEME_FONTS)('loads $family with Latin and Cyrillic letters, swapped in', (font) => {
    const options = optionsOf(font.family)
    expect(options.subsets).toEqual(['latin', 'cyrillic'])
    expect(options.display).toBe('swap')
    // A variable font: any weight a face asks for is the font's own. A fixed list of weights would
    // make the browser synthesise the others.
    expect(options.weight).toBeUndefined()
  })

  it.each(THEME_FONTS)('defines $family as the variable --font-$id', (font) => {
    expect(optionsOf(font.family).variable).toBe(`--font-${font.id}`)
  })

  it('preloads Inter and nothing else (guests and the admin would otherwise fetch twelve files)', () => {
    for (const font of THEME_FONTS) {
      const preload = optionsOf(font.family).preload
      if (font.id === 'inter') expect(preload ?? true).toBe(true)
      else expect(preload, font.family).toBe(false)
    }
  })
})

describe('the heaviest weight of each font (D130, Heading weight)', () => {
  const data = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../node_modules/next/dist/compiled/@next/font/dist/google/font-data.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as Record<string, { weights: string[] }>

  it.each(THEME_FONTS)('is what Next’s font data says $family serves', (font) => {
    const weights = (data[font.family]?.weights ?? [])
      .filter((weight) => weight !== 'variable')
      .map(Number)
    expect(data[font.family]?.weights).toContain('variable')
    expect(font.heaviest).toBe(Math.max(...weights))
  })

  it('stops short of the Heavy step (880) for Lora and Manrope only', () => {
    const short = THEME_FONTS.filter((font) => font.heaviest < 880).map((font) => font.id)
    expect(short).toEqual(['manrope', 'lora'])
  })
})

describe('FONT_VARIABLES', () => {
  it('holds the class name of every font, once, for the <html> element', () => {
    const classes = FONT_VARIABLES.split(' ')
    expect(classes).toHaveLength(THEME_FONTS.length)
    expect(new Set(classes).size).toBe(THEME_FONTS.length)
    for (const font of THEME_FONTS) {
      expect(FONT_VARIABLES).toContain(`--font-${font.id}`)
    }
  })
})

describe('FONT_STACKS', () => {
  it('has a stack for every family of THEME_FONTS, keyed by the family the snapshot carries', () => {
    expect(Object.keys(FONT_STACKS).sort()).toEqual(THEME_FONTS.map((font) => font.family).sort())
  })

  it.each(THEME_FONTS)(
    'puts our own file first for $family, then its name, then a system font',
    (font) => {
      const stack = FONT_STACKS[font.family] ?? ''
      expect(stack.startsWith(`var(--font-${font.id}), "${font.family}", `)).toBe(true)
      const fallback = stack.slice(`var(--font-${font.id}), "${font.family}", `.length)
      expect(fallback).toMatch(font.kind === 'serif' ? /(^|, )serif$/ : /sans-serif$/)
      // Only our own variable and system names: nothing that could name a host.
      expect(stack).not.toMatch(/https?:|\/\/|url\(/i)
    },
  )
})

describe('plainFontStack (a provider’s frame cannot read the page’s variables)', () => {
  it.each(THEME_FONTS)('is the name and a system font of the same kind for $family', (font) => {
    const stack = plainFontStack(font.family)
    expect(stack.startsWith(`"${font.family}", `)).toBe(true)
    expect(stack).not.toContain('var(')
    // The same fallback as the page's own stack.
    expect(FONT_STACKS[font.family]?.endsWith(stack.slice(`"${font.family}", `.length))).toBe(true)
  })

  it('falls back to a sans stack for a family it does not know', () => {
    expect(plainFontStack('Nope')).toBe('"Nope", system-ui, sans-serif')
  })
})
