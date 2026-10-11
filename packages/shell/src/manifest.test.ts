import { describe, expect, it } from 'vitest'

import {
  type FaceManifest,
  imageSlotsFor,
  type ManifestIssue,
  resolveOptions,
  validateManifest,
} from './manifest'

/** The manifest from the doc's "The face contract", with the doc's example values. */
function docManifest(): Record<string, unknown> {
  return {
    face: 'qr-mobile',
    version: '1.3.0',
    channels: ['qr'],
    slots: {
      'item.name': 'required',
      'item.price': 'required',
      'item.allergens': 'required',
      'item.state': 'required',
      'item.description': { optional: true, lines: 3, overflow: 'expand' },
      'item.image': { optional: true, variant: 'card', aspect: '4:3' },
      'item.badges': 'optional',
      'item.extra_fields': 'optional',
    },
    allergen_mode: 'inline_icons',
    no_image_layout: 'text_only',
    ordering: true,
    paging: null,
    tokens: ['palette.50', 'palette.500', 'palette.700', 'font', 'radius', 'shadow', 'logo'],
  }
}

function codes(input: unknown): ManifestIssue['code'][] {
  const result = validateManifest(input)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

function without(slot: string): Record<string, unknown> {
  const manifest = docManifest()
  const slots = { ...(manifest.slots as Record<string, unknown>) }
  delete slots[slot]
  return { ...manifest, slots }
}

function withSlot(slot: string, value: unknown): Record<string, unknown> {
  const manifest = docManifest()
  return { ...manifest, slots: { ...(manifest.slots as Record<string, unknown>), [slot]: value } }
}

describe('validateManifest', () => {
  it('accepts the manifest of the doc', () => {
    const result = validateManifest(docManifest())
    expect(result.ok).toBe(true)
  })

  it('R6: refuses a face with no way to reach allergens', () => {
    expect(codes(without('item.allergens'))).toEqual(['required_slot_missing'])
    expect(codes(withSlot('item.allergens', 'optional'))).toEqual(['required_slot_optional'])
    expect(codes({ ...docManifest(), allergen_mode: 'none' })).toEqual(['invalid_shape'])
    const noMode: Record<string, unknown> = docManifest()
    noMode.allergen_mode = undefined
    expect(codes(noMode)).toEqual(['invalid_shape'])
  })

  it('R7: refuses a face that leaves out or softens a required slot', () => {
    for (const slot of ['item.name', 'item.price', 'item.allergens', 'item.state']) {
      expect(codes(without(slot)), slot).toEqual(['required_slot_missing'])
      expect(codes(withSlot(slot, 'optional')), slot).toEqual(['required_slot_optional'])
      expect(codes(withSlot(slot, { optional: true })), slot).toEqual(['required_slot_has_options'])
    }
    expect(codes({ ...docManifest(), slots: {} })).toHaveLength(4)
  })

  it('refuses slots, tokens and keys it does not know', () => {
    expect(codes(withSlot('item.sparkle', 'optional'))).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), tokens: ['palette.51'] })).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), extra: 1 })).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), version: '1.3' })).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), face: 'QR Mobile' })).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), channels: [] })).toEqual(['invalid_shape'])
    expect(codes('nonsense')).toEqual(['invalid_shape'])
  })

  it('accepts the colour and palette tokens a theme provides', () => {
    const tokens = ['palette.950', 'color.background', 'color.on_accent', 'color.accent_text']
    expect(validateManifest({ ...docManifest(), tokens }).ok).toBe(true)
  })

  it('R9: cuts a description only where the guest can expand it', () => {
    const print = {
      ...docManifest(),
      channels: ['print'],
      ordering: false,
      paging: { mode: 'fixed_pages' },
      allergen_mode: 'numbered_legend',
    }
    expect(codes(print)).toEqual(['description_cut_without_expand'])
    const reflow = withSlot('item.description', { optional: true, overflow: 'reflow' })
    expect(validateManifest({ ...reflow, ...print, slots: reflow.slots }).ok).toBe(true)
    expect(validateManifest({ ...docManifest(), channels: ['qr', 'kiosk'] }).ok).toBe(true)
  })

  it('R9/R11: print and tv page, qr and kiosk scroll, ordering needs a touch channel', () => {
    const tv = {
      ...docManifest(),
      channels: ['tv'],
      ordering: false,
      allergen_mode: 'info_qr',
      slots: withSlot('item.description', { optional: true, overflow: 'reflow' }).slots,
    }
    expect(codes(tv)).toEqual(['paging_required'])
    expect(
      validateManifest({ ...tv, paging: { mode: 'rotating_pages', interval_seconds: 12 } }).ok,
    ).toBe(true)
    expect(codes({ ...docManifest(), paging: { mode: 'fixed_pages' } })).toEqual([
      'paging_on_scrolling_channel',
    ])
    expect(codes({ ...tv, ordering: true, paging: { mode: 'fixed_pages' } })).toEqual([
      'ordering_without_interactive_channel',
    ])
  })

  it('refuses repeated channels and tokens', () => {
    expect(codes({ ...docManifest(), channels: ['qr', 'qr'] })).toEqual(['duplicate_channel'])
    expect(codes({ ...docManifest(), tokens: ['font', 'font'] })).toEqual(['duplicate_token'])
  })

  it('reports where each issue is', () => {
    const result = validateManifest(without('item.price'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.path).toBe('slots.item.price')
  })
})

describe('imageSlotsFor', () => {
  it('turns the item.image slot into a context request', () => {
    const result = validateManifest(docManifest())
    if (!result.ok) throw new Error('manifest should be valid')
    expect(imageSlotsFor(result.manifest, 2)).toEqual({ item: { variant: 'card', density: 2 } })
    const thumb = validateManifest(withSlot('item.image', { optional: true, variant: 'thumb' }))
    if (!thumb.ok) throw new Error('manifest should be valid')
    expect(imageSlotsFor(thumb.manifest, 1).item.variant).toBe('thumb')
  })
})

/** A valid enum option, and a valid boolean one. */
const LAYOUT = {
  type: 'enum',
  values: ['list', 'one', 'two'],
  default: 'two',
  group: 'look',
  label: { bg: 'Подредба', en: 'Layout' },
} as const

const SWITCH = {
  type: 'boolean',
  default: true,
  group: 'feature',
  label: { bg: 'Превключвател', en: 'Layout switch' },
} as const

function withOptions(options: unknown) {
  return { ...docManifest(), options }
}

function manifestOf(input: unknown): FaceManifest {
  const result = validateManifest(input)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.manifest
}

describe('validateManifest: features (R15)', () => {
  it('defaults to no features and no options', () => {
    const manifest = manifestOf(docManifest())
    expect(manifest.features).toEqual([])
    expect(manifest.options).toEqual({})
  })

  it('accepts the five features a face can draw controls for', () => {
    const features = ['filters', 'call_waiter', 'bill', 'ordering', 'pay']
    expect(manifestOf({ ...docManifest(), features }).features).toEqual(features)
  })

  it('refuses a feature it does not know', () => {
    expect(codes({ ...docManifest(), features: ['filters', 'karaoke'] })).toEqual(['invalid_shape'])
    expect(codes({ ...docManifest(), features: 'filters' })).toEqual(['invalid_shape'])
  })

  it('refuses a feature listed twice', () => {
    expect(codes({ ...docManifest(), features: ['bill', 'bill'] })).toEqual(['duplicate_feature'])
  })

  it('refuses the ordering feature for a face that does not order (R11)', () => {
    expect(codes({ ...docManifest(), ordering: false, features: ['ordering'] })).toEqual([
      'ordering_feature_without_ordering',
    ])
    expect(validateManifest({ ...docManifest(), ordering: true, features: ['ordering'] }).ok).toBe(
      true,
    )
    // Any other feature is fine for a browse-only face.
    expect(
      validateManifest({
        ...docManifest(),
        ordering: false,
        features: ['filters', 'call_waiter', 'bill', 'pay'],
      }).ok,
    ).toBe(true)
  })
})

describe('validateManifest: options', () => {
  it('accepts enum and boolean options with a group and a label in both languages', () => {
    const manifest = manifestOf(withOptions({ layout: LAYOUT, layoutSwitch: SWITCH }))
    expect(Object.keys(manifest.options)).toEqual(['layout', 'layoutSwitch'])
    expect(manifest.options.layout).toEqual(LAYOUT)
  })

  it('refuses an enum default that is not one of its values', () => {
    const result = validateManifest(withOptions({ layout: { ...LAYOUT, default: 'three' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(['option_default_not_allowed'])
      expect(result.issues[0]?.path).toBe('options.layout.default')
    }
  })

  it('refuses a key that is not camelCase, or is too long', () => {
    for (const key of ['Layout', '1layout', 'layout_switch', 'layout-switch', 'a'.repeat(33), '']) {
      expect(codes(withOptions({ [key]: SWITCH })), key).toEqual(['invalid_shape'])
    }
    expect(validateManifest(withOptions({ ['a'.repeat(32)]: SWITCH })).ok).toBe(true)
  })

  it('refuses more than 16 options', () => {
    const many = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`option${i}`, SWITCH]))
    expect(validateManifest(withOptions(many(16))).ok).toBe(true)
    expect(codes(withOptions(many(17)))).toEqual(['invalid_shape'])
  })

  it('refuses an enum with no values, more than eight, a bad value, or a repeated one', () => {
    expect(codes(withOptions({ layout: { ...LAYOUT, values: [], default: 'two' } }))).toEqual([
      'invalid_shape',
    ])
    const nine = Array.from({ length: 9 }, (_, i) => `v${i}`)
    expect(codes(withOptions({ layout: { ...LAYOUT, values: nine, default: 'v0' } }))).toEqual([
      'invalid_shape',
    ])
    const eight = nine.slice(0, 8)
    expect(
      validateManifest(withOptions({ layout: { ...LAYOUT, values: eight, default: 'v0' } })).ok,
    ).toBe(true)
    for (const bad of ['Two', 'two words', 'a'.repeat(33), '', 'é']) {
      expect(
        codes(withOptions({ layout: { ...LAYOUT, values: ['one', bad], default: 'one' } })),
        bad,
      ).toEqual(['invalid_shape'])
    }
    expect(
      codes(withOptions({ layout: { ...LAYOUT, values: ['one', 'one'], default: 'one' } })),
    ).toEqual(['invalid_shape'])
  })

  it('refuses a missing or unknown group, a missing or incomplete label, and unknown fields', () => {
    const { group: _group, ...noGroup } = LAYOUT
    const { label: _label, ...noLabel } = LAYOUT
    for (const bad of [
      noGroup,
      { ...LAYOUT, group: 'colour' },
      noLabel,
      { ...LAYOUT, label: { en: 'Layout' } },
      { ...LAYOUT, label: { bg: '', en: 'Layout' } },
      { ...LAYOUT, label: { bg: 'a', en: 'b', de: 'c' } },
      { ...LAYOUT, sparkle: true },
    ]) {
      expect(codes(withOptions({ layout: bad })), JSON.stringify(bad)).toEqual(['invalid_shape'])
    }
  })

  it('refuses a boolean whose default is not a boolean, and a type it does not know', () => {
    expect(codes(withOptions({ layoutSwitch: { ...SWITCH, default: 'true' } }))).toEqual([
      'invalid_shape',
    ])
    expect(codes(withOptions({ layoutSwitch: { ...SWITCH, values: ['a'] } }))).toEqual([
      'invalid_shape',
    ])
    expect(codes(withOptions({ size: { ...SWITCH, type: 'number', default: 3 } }))).toEqual([
      'invalid_shape',
    ])
  })
})

describe('resolveOptions', () => {
  const manifest = manifestOf(
    withOptions({
      layout: LAYOUT,
      layoutSwitch: SWITCH,
      showPrices: { ...SWITCH, default: false, group: 'look' },
    }),
  )
  const defaults = { layout: 'two', layoutSwitch: true, showPrices: false }

  it('gives the defaults for nothing at all, however nothing is spelled', () => {
    for (const raw of [undefined, null, {}, 'layout', 7, true, [], ['list']]) {
      expect(resolveOptions(manifest, raw), String(raw)).toEqual(defaults)
    }
  })

  it('keeps a value that is right', () => {
    const given = { layout: 'list', layoutSwitch: false, showPrices: true }
    expect(resolveOptions(manifest, given)).toEqual(given)
  })

  it('fills in what is missing with the default', () => {
    expect(resolveOptions(manifest, { layout: 'one' })).toEqual({ ...defaults, layout: 'one' })
    expect(resolveOptions(manifest, { showPrices: true })).toEqual({
      ...defaults,
      showPrices: true,
    })
  })

  it('drops a key the manifest does not declare', () => {
    const resolved = resolveOptions(manifest, { layout: 'one', colour: 'red', mode: true })
    expect(resolved).toEqual({ ...defaults, layout: 'one' })
    expect(Object.keys(resolved).sort()).toEqual(['layout', 'layoutSwitch', 'showPrices'])
  })

  it('replaces a value of the wrong type with the default', () => {
    expect(
      resolveOptions(manifest, { layout: true, layoutSwitch: 'false', showPrices: 1 }),
    ).toEqual(defaults)
    expect(resolveOptions(manifest, { layout: 2, layoutSwitch: null, showPrices: {} })).toEqual(
      defaults,
    )
  })

  it('replaces an enum value the manifest does not list with the default', () => {
    expect(resolveOptions(manifest, { layout: 'three' })).toEqual(defaults)
    expect(resolveOptions(manifest, { layout: 'Two' })).toEqual(defaults)
    expect(resolveOptions(manifest, { layout: '' })).toEqual(defaults)
  })

  it('reads only the object’s own keys', () => {
    const inherited = Object.create({ layout: 'list' }) as Record<string, unknown>
    expect(resolveOptions(manifest, inherited)).toEqual(defaults)
  })

  it('gives nothing for a face with no options', () => {
    expect(resolveOptions(manifestOf(docManifest()), { layout: 'list' })).toEqual({})
  })

  it('does not change what it is given', () => {
    const raw = Object.freeze({ layout: 'one', extra: 1 })
    expect(resolveOptions(manifest, raw)).toEqual({ ...defaults, layout: 'one' })
    expect(raw).toEqual({ layout: 'one', extra: 1 })
  })
})
