import { describe, expect, it } from 'vitest'

import { assetVariantFile, parseAssetVariants, planAssetVariants } from './asset-variants'
import { newId } from './ids'

describe('planAssetVariants', () => {
  it('makes the three usual widths for a large photo', () => {
    expect(planAssetVariants(2000)).toEqual({
      variants: { thumb: 320, card: 640, full: 1280 },
      files: [320, 640, 1280],
    })
  })

  it('never goes wider than the original, and shares one file between names', () => {
    expect(planAssetVariants(300)).toEqual({
      variants: { thumb: 300, card: 300, full: 300 },
      files: [300],
    })
    expect(planAssetVariants(500)).toEqual({
      variants: { thumb: 320, card: 500, full: 500 },
      files: [320, 500],
    })
    expect(planAssetVariants(1280).files).toEqual([320, 640, 1280])
    expect(planAssetVariants(1).files).toEqual([1])
  })

  it.each([0, -3, 1.5, Number.NaN])('refuses a width of %s', (width) => {
    expect(() => planAssetVariants(width)).toThrow(RangeError)
  })
})

describe('assetVariantFile', () => {
  it('is the publish-store path the snapshot paths point at', () => {
    const id = newId('as')
    expect(assetVariantFile(id, 640)).toBe(`a/${id}/w640.webp`)
  })
})

describe('parseAssetVariants', () => {
  it('reads a stored record', () => {
    expect(parseAssetVariants({ thumb: 320, card: 640, full: 1280 })).toEqual({
      thumb: 320,
      card: 640,
      full: 1280,
    })
    expect(parseAssetVariants({ thumb: 300, card: 300, full: 300 })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a missing width', { thumb: 320, card: 640 }],
    ['an extra key', { thumb: 320, card: 640, full: 1280, huge: 2560 }],
    ['widths that shrink', { thumb: 640, card: 320, full: 1280 }],
    ['a fraction', { thumb: 320.5, card: 640, full: 1280 }],
    ['a text width', { thumb: '320', card: 640, full: 1280 }],
    ['an array', [320, 640, 1280]],
  ])('counts %s as no variants', (_label, value) => {
    expect(parseAssetVariants(value)).toBeNull()
  })
})
