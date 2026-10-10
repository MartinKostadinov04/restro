import { describe, expect, it } from 'vitest'

import { imageSlotsFor, type ManifestIssue, validateManifest } from './manifest'

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
