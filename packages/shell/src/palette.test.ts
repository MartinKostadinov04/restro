import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  contrastRatio,
  FALLBACK_BRAND,
  generatePalette,
  hexToHsl,
  hslToHex,
  isHexColour,
  MIN_TEXT_CONTRAST,
  PALETTE_STEPS,
  readableOn,
  relativeLuminance,
  resolvePalette,
  semanticColours,
  semanticColoursDark,
  textOn,
} from './palette'

const hexColour = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`)

describe('palette helper (R13)', () => {
  it('lays out the Platform steps: 50 to 950 at lightness .95 down to .05', () => {
    const palette = generatePalette('#808080')
    expect(Object.keys(palette).map(Number)).toEqual([...PALETTE_STEPS])
    expect(palette[50]).toBe('#f2f2f2')
    expect(palette[500]).toBe('#808080')
    expect(palette[950]).toBe('#0d0d0d')
  })

  it('keeps hue and saturation of the brand colour, changing only lightness', () => {
    const brand = '#3366cc'
    const { h, s } = hexToHsl(brand)
    const palette = generatePalette(brand)
    for (const step of PALETTE_STEPS) {
      const colour = hexToHsl(palette[step])
      // Steps near white or black lose precision in 8-bit channels; the hue holds elsewhere.
      if (step >= 100 && step <= 900) {
        expect(colour.h).toBeCloseTo(h, -1)
        expect(colour.s).toBeCloseTo(s, 1)
      }
    }
    const lightness = PALETTE_STEPS.map((step) => hexToHsl(palette[step]).l)
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness)
  })

  it('converts hex to HSL and back within one unit per channel', () => {
    fc.assert(
      fc.property(hexColour, (hex) => {
        const { h, s, l } = hexToHsl(hex)
        const back = hslToHex(h, s, l)
        for (const i of [1, 3, 5]) {
          const a = Number.parseInt(hex.slice(i, i + 2), 16)
          const b = Number.parseInt(back.slice(i, i + 2), 16)
          expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
        }
      }),
    )
  })

  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  it('picks the first readable candidate and falls back to the closest', () => {
    expect(readableOn(['#ffffff'], ['#aaaaaa', '#222222', '#000000'])).toBe('#222222')
    expect(readableOn(['#808080'], ['#777777', '#888888'])).toBe('#777777')
  })

  it('gives every brand colour readable pairs (property)', () => {
    fc.assert(
      fc.property(hexColour, (brand) => {
        const c = semanticColours(generatePalette(brand))
        const ok = (a: string, b: string) =>
          expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        ok(c.text, c.background)
        ok(c.text, c.surface)
        ok(c.muted, c.background)
        ok(c.muted, c.surface)
        ok(c.accentText, c.background)
        ok(c.accentText, c.surface)
        ok(c.onAccent, c.accent)
      }),
      { numRuns: 500 },
    )
  })

  it('gives every brand colour readable pairs on a dark screen too (property)', () => {
    fc.assert(
      fc.property(hexColour, (brand) => {
        const c = semanticColoursDark(generatePalette(brand))
        const ok = (a: string, b: string) =>
          expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        ok(c.text, c.background)
        ok(c.text, c.surface)
        ok(c.muted, c.background)
        ok(c.muted, c.surface)
        ok(c.accentText, c.background)
        ok(c.accentText, c.surface)
        ok(c.onAccent, c.accent)
        // The dark page is darker than the light one.
        expect(relativeLuminance(c.background)).toBeLessThan(relativeLuminance(c.text))
      }),
      { numRuns: 500 },
    )
  })

  it('gives a readable text colour on any section colour (property)', () => {
    const palette = generatePalette('#3366cc')
    fc.assert(
      fc.property(hexColour, (colour) => {
        expect(contrastRatio(textOn(colour, palette), colour)).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        )
      }),
      { numRuns: 500 },
    )
  })

  it('uses a snapshot palette of eleven colours as it is, step by step', () => {
    const colours = PALETTE_STEPS.map((_, i) => hslToHex(200, 0.4, 0.95 - i * 0.09))
    const palette = resolvePalette(colours)
    PALETTE_STEPS.forEach((step, i) => {
      expect(palette[step]).toBe(colours[i])
    })
  })

  it('lays out the steps itself for any other list, from the colour nearest the middle', () => {
    expect(resolvePalette(['#3366cc'])).toEqual(generatePalette('#3366cc'))
    expect(resolvePalette(['#ffffff', '#3366cc', '#000000'])).toEqual(generatePalette('#3366cc'))
  })

  it('ignores colours that are not #rrggbb and falls back to the neutral grey', () => {
    expect(isHexColour('#12abEF')).toBe(true)
    expect(isHexColour('red')).toBe(false)
    expect(resolvePalette([])).toEqual(generatePalette(FALLBACK_BRAND))
    expect(generatePalette('nonsense')).toEqual(generatePalette(FALLBACK_BRAND))
  })
})
