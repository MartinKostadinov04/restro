import { MIN_TEXT_CONTRAST } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { BRAND_SWATCHES, normaliseHex, PAIR_KEYS, previewOf } from './preview'

describe('the Appearance preview', () => {
  it('reads a typed colour in the forms people type', () => {
    expect(normaliseHex('#3366CC')).toBe('#3366cc')
    expect(normaliseHex('3366cc')).toBe('#3366cc')
    expect(normaliseHex('  #36c ')).toBe('#3366cc')
    for (const bad of ['', '#', 'blue', '#12345', '#1234567', '#gggggg', 'rgb(1,2,3)']) {
      expect(normaliseHex(bad), bad).toBeNull()
    }
  })

  it('gives every offered swatch readable pairs on a light and a dark screen', () => {
    for (const brand of BRAND_SWATCHES) {
      const { light, dark } = previewOf(brand)
      for (const scheme of [light, dark]) {
        expect(scheme.pairs.map((pair) => pair.key)).toEqual([...PAIR_KEYS])
        for (const pair of scheme.pairs) {
          expect(pair.ratio, `${brand} ${pair.key}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      }
    }
  })

  it('previews the brand colour as the accent and falls back to grey for nonsense', () => {
    expect(previewOf('#3366cc').light.colours.accent).toBe('#3366cc')
    expect(previewOf('nonsense').light.colours).toEqual(previewOf('#6b7280').light.colours)
  })
})
