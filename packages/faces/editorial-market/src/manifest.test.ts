import { resolveOptions, validateManifest } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { EDITORIAL_MARKET_MANIFEST } from './manifest'
import { faceOptions, LAYOUTS } from './model'

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

  it('declares the three options of the brief, with defaults, groups and labels in both languages', () => {
    const { options } = EDITORIAL_MARKET_MANIFEST
    expect(Object.keys(options).sort()).toEqual(['featureFirstSection', 'layout', 'layoutSwitch'])
    expect(options.layout).toMatchObject({
      type: 'enum',
      values: ['list', 'one', 'two'],
      default: 'two',
      group: 'look',
    })
    expect(options.featureFirstSection).toMatchObject({
      type: 'boolean',
      default: true,
      group: 'look',
    })
    expect(options.layoutSwitch).toMatchObject({
      type: 'boolean',
      default: true,
      group: 'feature',
    })
    for (const [key, option] of Object.entries(options)) {
      expect(option.label.bg.trim().length, key).toBeGreaterThan(0)
      expect(option.label.en.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('lists the layouts the face can draw, no more and no fewer', () => {
    const layout = EDITORIAL_MARKET_MANIFEST.options.layout
    expect(layout?.type === 'enum' ? layout.values : null).toEqual([...LAYOUTS])
  })

  it('has defaults that the face and the manifest agree on', () => {
    const resolved = resolveOptions(EDITORIAL_MARKET_MANIFEST, undefined)
    expect(resolved).toEqual({ layout: 'two', layoutSwitch: true, featureFirstSection: true })
    // faceOptions only narrows the types; it never changes a resolved value.
    expect(faceOptions(resolved)).toEqual(resolved)
    for (const layout of LAYOUTS) {
      expect(faceOptions(resolveOptions(EDITORIAL_MARKET_MANIFEST, { layout })).layout).toBe(layout)
    }
  })
})
