// Colour-theory suggestions (brief SH-01 §5): each rule's hue relations in OKLCH.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { hexToOklch } from './colour'
import { deriveRoles } from './derive'
import { HARMONY_OFFSETS, HARMONY_RULES, suggestHarmony } from './harmony'
import { validateRoles } from './roles'

const hexColour = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`)

/** Seeds with enough colour for a hue to mean something (a grey has none). */
const colourfulSeed = hexColour.filter((hex) => hexToOklch(hex).c >= 0.1)

const hueDistance = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

/** 8-bit channels limit how exactly a light, low-chroma colour can hold its hue. */
const HUE_TOLERANCE = 10

describe('suggestHarmony', () => {
  it('offers the five rules', () => {
    expect(HARMONY_RULES).toEqual([
      'complementary',
      'analogous',
      'triadic',
      'split_complementary',
      'monochrome',
    ])
  })

  it.each([
    ['complementary', 180, 180],
    ['analogous', 30, -30],
    ['triadic', 120, 240],
    ['split_complementary', 150, 210],
    ['monochrome', 0, 0],
  ] as const)(
    '%s puts the page at +%i° and the panels at %i° from the seed',
    (rule, page, panels) => {
      expect(HARMONY_OFFSETS[rule]).toEqual([page, panels])
      fc.assert(
        fc.property(colourfulSeed, (seed) => {
          const suggestion = suggestHarmony(seed, rule)
          const hue = hexToOklch(seed).h
          expect(hueDistance(hexToOklch(suggestion.primary).h, hue + page)).toBeLessThan(
            HUE_TOLERANCE,
          )
          expect(hueDistance(hexToOklch(suggestion.secondary).h, hue + panels)).toBeLessThan(
            HUE_TOLERANCE,
          )
        }),
        { numRuns: 200 },
      )
    },
  )

  it('keeps the seed as the tertiary, a light calm page and slightly deeper panels', () => {
    fc.assert(
      fc.property(hexColour, fc.constantFrom(...HARMONY_RULES), (seed, rule) => {
        const suggestion = suggestHarmony(seed.toUpperCase(), rule)
        expect(suggestion.tertiary).toBe(seed)
        const page = hexToOklch(suggestion.primary)
        const panels = hexToOklch(suggestion.secondary)
        expect(page.l).toBeGreaterThanOrEqual(0.94)
        expect(page.l).toBeLessThanOrEqual(0.97)
        expect(page.c).toBeLessThanOrEqual(0.025)
        expect(panels.l).toBeLessThan(page.l)
        expect(panels.c).toBeLessThanOrEqual(0.04)
      }),
      { numRuns: 300 },
    )
  })

  it('is deterministic, and a grey seed gives grey page and panels', () => {
    for (const rule of HARMONY_RULES) {
      expect(suggestHarmony('#c8372d', rule)).toEqual(suggestHarmony('#c8372d', rule))
      const grey = suggestHarmony('#808080', rule)
      expect(hexToOklch(grey.primary).c).toBeLessThan(0.002)
      expect(hexToOklch(grey.secondary).c).toBeLessThan(0.002)
    }
  })

  it('gives three colours whose derived roles read', () => {
    fc.assert(
      fc.property(hexColour, fc.constantFrom(...HARMONY_RULES), (seed, rule) => {
        expect(validateRoles(deriveRoles(suggestHarmony(seed, rule)))).toEqual([])
      }),
      { numRuns: 100 },
    )
  })
})
