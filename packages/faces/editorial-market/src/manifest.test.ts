import { resolveOptions, validateManifest } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_MARKET_MANIFEST } from './manifest'

describe('the editorial-market manifest', () => {
  it('passes validateManifest (R6, R7, R9)', () => {
    expect(validateManifest(EDITORIAL_MARKET_MANIFEST).ok).toBe(true)
  })

  it('declares what the brief asks for', () => {
    expect(EDITORIAL_MARKET_MANIFEST).toMatchObject({
      face: 'editorial-market',
      version: '1.0.0',
      channels: ['qr'],
      paging: null,
      allergen_mode: 'inline_codes',
      no_image_layout: 'text_only',
      // The service screens (SH-06): the face orders, and draws a control only when R15 lets it.
      ordering: true,
    })
    expect(EDITORIAL_MARKET_MANIFEST.slots['item.image']).toEqual({
      optional: true,
      variant: 'card',
      aspect: '4:3',
    })
    expect(EDITORIAL_MARKET_MANIFEST.slots['item.description']).toEqual({
      optional: true,
      lines: 3,
      overflow: 'expand',
    })
    for (const slot of ['item.name', 'item.price', 'item.allergens', 'item.state'] as const) {
      expect(EDITORIAL_MARKET_MANIFEST.slots[slot], slot).toBe('required')
    }
    for (const slot of [
      'item.badges',
      'item.portion',
      'item.dietary',
      'item.tags',
      'item.extra_fields',
      'item.modifiers',
    ] as const) {
      expect(EDITORIAL_MARKET_MANIFEST.slots[slot], slot).toBe('optional')
    }
  })

  it('asks for the eight colours, the font, the radius, the shadow and the logo', () => {
    expect([...EDITORIAL_MARKET_MANIFEST.tokens].sort()).toEqual(
      [
        'color.accent',
        'color.accent_text',
        'color.background',
        'color.border',
        'color.muted',
        'color.on_accent',
        'color.surface',
        'color.text',
        'font',
        'logo',
        'radius',
        'shadow',
      ].sort(),
    )
  })
})

describe('the editorial-market manifest: features and options (R15)', () => {
  it('has controls for the filters and for every service (SH-06): waiter, bill, ordering, pay', () => {
    expect(EDITORIAL_MARKET_MANIFEST.features).toEqual([
      'filters',
      'call_waiter',
      'bill',
      'ordering',
      'pay',
    ])
  })

  it('declares no options: the layouts are the menu’s settings now (D92)', () => {
    // `layout`, `layoutSwitch` and `featureFirstSection` moved to the composer: the snapshot
    // carries the menu's layout and each section's layout hint, which the face reads.
    expect(EDITORIAL_MARKET_MANIFEST.options).toEqual({})
    expect(resolveOptions(EDITORIAL_MARKET_MANIFEST, undefined)).toEqual({})
    // An old venue's stored options are dropped, never read.
    expect(
      resolveOptions(EDITORIAL_MARKET_MANIFEST, {
        layout: 'list',
        layoutSwitch: false,
        featureFirstSection: false,
      }),
    ).toEqual({})
  })
})
