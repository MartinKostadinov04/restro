// The colour maths (brief SH-01 §2): sRGB ↔ linear ↔ OKLab ↔ OKLCH round trips, Ottosson's
// reference values, and the gamut-safe conversion back to `#rrggbb`.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  hexToLinearRgb,
  hexToOklab,
  hexToOklch,
  hexToRgb,
  isInSrgbGamut,
  linearRgbToHex,
  mixOklab,
  oklabToHex,
  oklchToHex,
  rgbToHex,
} from './colour'

const hexColour = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`)

/** The largest difference of one channel between two colours. */
function channelDistance(a: string, b: string): number {
  const [ra, ga, ba] = hexToRgb(a)
  const [rb, gb, bb] = hexToRgb(b)
  return Math.max(Math.abs(ra - rb), Math.abs(ga - gb), Math.abs(ba - bb))
}

/** The difference of two hues in degrees, 0–180. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('OKLab and OKLCH', () => {
  it('match the published reference values (CSS Color 4, Ottosson)', () => {
    const cases: [string, number, number, number][] = [
      ['#ff0000', 0.62796, 0.25768, 29.2339],
      ['#00ff00', 0.86644, 0.29483, 142.4953],
      ['#0000ff', 0.45201, 0.31321, 264.052],
    ]
    for (const [hex, l, c, h] of cases) {
      const lch = hexToOklch(hex)
      expect(lch.l, hex).toBeCloseTo(l, 3)
      expect(lch.c, hex).toBeCloseTo(c, 3)
      expect(lch.h, hex).toBeCloseTo(h, 1)
    }
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 4)
    expect(hexToOklch('#ffffff').c).toBeLessThan(1e-4)
    expect(hexToOklch('#000000')).toEqual({ l: 0, c: 0, h: 0 })
  })

  it('round-trips every sRGB colour through OKLCH within ±1 per channel', () => {
    fc.assert(
      fc.property(hexColour, (hex) => {
        expect(channelDistance(oklchToHex(hexToOklch(hex)), hex)).toBeLessThanOrEqual(1)
        expect(channelDistance(oklabToHex(hexToOklab(hex)), hex)).toBeLessThanOrEqual(1)
        expect(linearRgbToHex(hexToLinearRgb(hex))).toBe(hex)
      }),
      { numRuns: 2000 },
    )
  })

  it('counts every sRGB colour as inside the gamut', () => {
    fc.assert(fc.property(hexColour, (hex) => isInSrgbGamut(hexToOklch(hex))))
  })

  it('reduces chroma, keeping lightness and hue, when a colour does not fit sRGB', () => {
    const wanted = { l: 0.7, c: 0.4, h: 150 }
    expect(isInSrgbGamut(wanted)).toBe(false)
    const hex = oklchToHex(wanted)
    const got = hexToOklch(hex)
    expect(got.c).toBeLessThan(wanted.c)
    expect(got.l).toBeCloseTo(wanted.l, 2)
    expect(hueDistance(got.h, wanted.h)).toBeLessThan(2)
  })

  it('never throws and always lands in sRGB, whatever the OKLCH input', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.5, max: 1.5, noNaN: true }),
        fc.double({ min: 0, max: 0.6, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (l, c, h) => {
          const hex = oklchToHex({ l, c, h })
          expect(hex).toMatch(/^#[0-9a-f]{6}$/)
        },
      ),
    )
    expect(oklchToHex({ l: 1, c: 0.2, h: 40 })).toBe('#ffffff')
    expect(oklchToHex({ l: 0, c: 0.2, h: 40 })).toBe('#000000')
  })

  it('mixes in OKLab: the ends are the colours themselves, the middle lies between', () => {
    fc.assert(
      fc.property(hexColour, hexColour, (a, b) => {
        expect(channelDistance(mixOklab(a, b, 0), a)).toBeLessThanOrEqual(1)
        expect(channelDistance(mixOklab(a, b, 1), b)).toBeLessThanOrEqual(1)
        const middle = hexToOklab(mixOklab(a, b, 0.5)).l
        const [la, lb] = [hexToOklab(a).l, hexToOklab(b).l]
        expect(middle).toBeGreaterThanOrEqual(Math.min(la, lb) - 0.01)
        expect(middle).toBeLessThanOrEqual(Math.max(la, lb) + 0.01)
      }),
    )
  })

  it('keeps the v1 conversions as they were', () => {
    expect(rgbToHex(255.4, -3, 300)).toBe('#ff00ff')
    expect(() => hexToRgb('#abc')).toThrow(RangeError)
  })
})
