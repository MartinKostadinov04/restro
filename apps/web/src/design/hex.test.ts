import { describe, expect, it } from 'vitest'

import { BRAND_SWATCHES, normaliseHex } from './hex'

describe('hex colours as typed', () => {
  it('reads a typed colour in the forms people type', () => {
    expect(normaliseHex('#3366CC')).toBe('#3366cc')
    expect(normaliseHex('3366cc')).toBe('#3366cc')
    expect(normaliseHex('  #36c ')).toBe('#3366cc')
    for (const bad of ['', '#', 'blue', '#12345', '#1234567', '#gggggg', 'rgb(1,2,3)']) {
      expect(normaliseHex(bad), bad).toBeNull()
    }
  })

  it('offers only colours that are colours', () => {
    for (const swatch of BRAND_SWATCHES) expect(normaliseHex(swatch)).toBe(swatch)
  })
})
