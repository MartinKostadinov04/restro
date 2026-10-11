// The Design tab's form rules (brief SH-05a, D70): where a look starts, what the form works out to,
// and that it is always a WHOLE look that passes the readability check or is refused.
import {
  HARMONY_RULES,
  REQUIRED_PAIRS,
  ROLE_MODES,
  ROLE_NAMES,
  suggestHarmony,
  THEME_PRESETS,
  themeRolesOf,
  VenueThemeSchema,
  validateRoles,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import { BRAND_SWATCHES } from './hex'
import {
  applyHarmony,
  clearOverride,
  isFromPreset,
  isOverridden,
  isValidLook,
  lookStateOf,
  lookViewOf,
  pairsOfRole,
  setColour,
  setOverride,
  shownRatio,
  startCustom,
  startFromBrand,
  startFromPreset,
} from './look-state'

const NONE = lookStateOf(null)

/** The look of a form state, which must be whole. */
function themeOf(state: ReturnType<typeof lookStateOf>) {
  const view = lookViewOf(state)
  if (!isValidLook(view)) throw new Error(`not a whole look: ${view.invalid.join()}`)
  return view
}

describe('the form state of a saved look', () => {
  it('starts a venue with no look on the default look: one brand colour, none chosen', () => {
    expect(NONE.source).toBe('brand')
    expect(NONE.brand).toBe('')
    expect(NONE.preset).toBeNull()
    expect(NONE.scheme).toBe('auto')
    expect(NONE.font).toBe('inter')
    // Nothing to save until something changes.
    const view = themeOf(NONE)
    expect(view.theme).toEqual({
      logo_asset_id: null,
      font: 'inter',
      radius: 8,
      shadow: 1,
      scheme: 'auto',
    })
    // The neutral default palette, which already reads.
    expect(view.issues).toEqual([])
  })

  it('maps a v1 look to "From my brand colour" and keeps its brand colour and logo', () => {
    const state = lookStateOf({ brand: '#2563eb', logo_asset_id: 'as_0123456789ABCDEFGHIJKL' })
    expect(state.source).toBe('brand')
    expect(state.brand).toBe('#2563eb')
    expect(state.logoAssetId).toBe('as_0123456789ABCDEFGHIJKL')
    expect(themeOf(state).theme).toMatchObject({
      brand: '#2563eb',
      logo_asset_id: 'as_0123456789ABCDEFGHIJKL',
      font: 'inter',
      radius: 8,
      shadow: 1,
      scheme: 'auto',
    })
  })

  it('round-trips a v2 look through the form', () => {
    const saved = VenueThemeSchema.parse({
      logo_asset_id: null,
      preset: null,
      colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      overrides: { dark: { background: '#101010' } },
      font: 'lora',
      radius: 12,
      shadow: 3,
      scheme: 'dark',
    })
    const view = themeOf(lookStateOf(saved))
    expect(view.theme).toEqual(saved)
    expect(view.roles).toEqual(themeRolesOf(saved))
  })

  it('always builds every v2 field, so a save can never be partial', () => {
    for (const state of [
      NONE,
      startFromPreset(NONE, 'midnight'),
      startCustom(startFromBrand(NONE)),
    ]) {
      const { theme } = themeOf(state)
      expect(theme).toHaveProperty('font')
      expect(theme).toHaveProperty('radius')
      expect(theme).toHaveProperty('shadow')
      expect(theme).toHaveProperty('scheme')
      expect(theme).toHaveProperty('logo_asset_id')
      expect(VenueThemeSchema.safeParse(theme).success).toBe(true)
    }
  })
})

describe('starting points', () => {
  it.each(THEME_PRESETS)('$id fills the three colours, all 16 roles and the corners', (preset) => {
    const state = startFromPreset(NONE, preset.id)
    expect(state.source).toBe('colours')
    expect(state.preset).toBe(preset.id)
    expect(state.colours).toEqual(preset.colours)
    expect(state.radius).toBe(preset.radius)
    for (const mode of ROLE_MODES) {
      expect(state.overrides[mode]).toEqual(preset.overrides[mode])
    }
    // The designer's own values read, and the tab shows exactly them.
    const view = themeOf(state)
    expect(view.issues).toEqual([])
    expect(view.roles).toEqual(preset.overrides)
    for (const role of ROLE_NAMES) expect(isFromPreset(state, 'light', role)).toBe(true)
  })

  it('"From my brand colour" gives the first version’s look back and drops the preset’s roles', () => {
    const state = startFromBrand(startFromPreset(NONE, 'nordic'))
    expect(state.source).toBe('brand')
    expect(state.preset).toBeNull()
    expect(state.overrides).toEqual({ light: {}, dark: {} })
    expect(themeOf(state).theme).not.toHaveProperty('colors')
  })

  it('"Custom" from a brand colour starts from a monochrome of it', () => {
    const state = startCustom({ ...NONE, brand: '#7c3aed' })
    expect(state.source).toBe('colours')
    expect(state.preset).toBeNull()
    expect(state.colours).toEqual(suggestHarmony('#7c3aed', 'monochrome'))
  })

  it('"Custom" from a preset keeps its colours and releases its pinned roles', () => {
    const preset = startFromPreset(NONE, 'midnight')
    const state = startCustom(preset)
    expect(state.preset).toBeNull()
    expect(state.colours).toEqual(preset.colours)
    expect(state.overrides).toEqual({ light: {}, dark: {} })
  })
})

describe('changing the colours', () => {
  it('releases the preset’s roles so the new colours take effect, and keeps the person’s own', () => {
    let state = startFromPreset(NONE, 'midnight')
    // The person sets one role by hand first (a value that is not the preset's).
    state = setOverride(state, 'light', 'border', '#abcdef')
    state = setColour(state, 'tertiary', '#2563eb')
    expect(state.preset).toBeNull()
    expect(state.colours.tertiary).toBe('#2563eb')
    expect(state.overrides.light).toEqual({ border: '#abcdef' })
    expect(state.overrides.dark).toEqual({})
    // The new accent shows in the roles (Midnight's pinned gold is gone).
    const view = themeOf(state)
    expect(view.roles.light.accent).toBe('#2563eb')
    expect(view.issues).toEqual([])
  })

  it('keeps half a colour as typed and marks it, without a whole look to save', () => {
    const state = setColour(startCustom(NONE), 'primary', '#12')
    const view = lookViewOf(state)
    expect(view.theme).toBeNull()
    expect(view.invalid).toEqual(['primary'])
    expect(isValidLook(view)).toBe(false)
    expect(state.colours.primary).toBe('#12')
  })

  it('takes a brand colour that is not a colour as a marked field, and an empty one as none', () => {
    expect(lookViewOf({ ...NONE, brand: 'blue' }).invalid).toEqual(['brand'])
    expect(lookViewOf({ ...NONE, brand: '' }).invalid).toEqual([])
  })
})

describe('"suggest with colour theory"', () => {
  it.each(HARMONY_RULES)('%s fills the primary and the secondary from the tertiary', (rule) => {
    const start = startFromPreset(NONE, 'nordic')
    const state = applyHarmony(start, rule)
    expect(state.colours).toEqual(suggestHarmony(start.colours.tertiary, rule))
    // The tertiary stays exactly as chosen.
    expect(state.colours.tertiary).toBe(start.colours.tertiary)
    expect(state.preset).toBeNull()
    // Derived roles always read, whatever the rule gave.
    expect(themeOf(state).issues).toEqual([])
  })

  it('seeds from the brand colour when the look is still on one, and switches to the three colours', () => {
    const state = applyHarmony({ ...NONE, brand: '#e11d48' }, 'triadic')
    expect(state.source).toBe('colours')
    expect(state.colours).toEqual(suggestHarmony('#e11d48', 'triadic'))
  })
})

describe('the brand swatches', () => {
  it('give readable roles on a light and a dark screen', () => {
    for (const brand of BRAND_SWATCHES) {
      const view = themeOf({ ...NONE, brand })
      expect(view.issues, brand).toEqual([])
    }
  })
})

describe('roles set by hand', () => {
  it('lays an override over the derived role and reports a pair that does not read', () => {
    const state = setOverride(startFromPreset(NONE, 'botanical'), 'light', 'text', '#f4efe6')
    const view = themeOf(state)
    expect(view.roles.light.text).toBe('#f4efe6')
    // Text the colour of the page: it fails against the page and the panels, in the light set only.
    expect(view.issues.map((i) => `${i.mode}:${i.fg}-on-${i.bg}`)).toEqual([
      'light:text-on-background',
      'light:text-on-surface',
    ])
    expect(view.issues).toEqual(validateRoles(view.roles))
  })

  it('"Reset to derived" takes the override off and the role is derived again', () => {
    const base = startFromPreset(NONE, 'botanical')
    const broken = setOverride(base, 'light', 'text', '#f4efe6')
    expect(isOverridden(broken, 'light', 'text')).toBe(true)
    const reset = clearOverride(broken, 'light', 'text')
    expect(isOverridden(reset, 'light', 'text')).toBe(false)
    const view = themeOf(reset)
    expect(view.roles.light.text).toBe(view.derived.light.text)
    expect(view.issues).toEqual([])
  })

  it('marks an override that is not a colour and holds the whole look back', () => {
    const view = lookViewOf(setOverride(NONE, 'dark', 'accent', '#12'))
    expect(view.theme).toBeNull()
    expect(view.invalid).toEqual(['dark.accent'])
  })

  it('stores only the roles set, per screen, as lower-case hex', () => {
    const { theme } = themeOf(setOverride(NONE, 'dark', 'border', '#ABCDEF'))
    expect(theme.overrides).toEqual({ dark: { border: '#abcdef' } })
  })
})

describe('contrast pairs', () => {
  it('lists the required pairs a role takes part in, as seen from that role', () => {
    expect(pairsOfRole('background').map((p) => p.other)).toEqual(['text', 'muted', 'accent_text'])
    expect(pairsOfRole('text').map((p) => p.other)).toEqual(['background', 'surface'])
    expect(pairsOfRole('accent').map((p) => p.other)).toEqual(['on_accent'])
    expect(pairsOfRole('border')).toEqual([])
    // Every required pair is shown from both of its roles.
    const seen = ROLE_NAMES.flatMap((role) => pairsOfRole(role)).length
    expect(seen).toBe(REQUIRED_PAIRS.length * 2)
  })

  it('shows a ratio rounded down, so 4.49 never reads as the passing 4.5', () => {
    expect(shownRatio(4.49)).toBe(4.4)
    expect(shownRatio(4.5)).toBe(4.5)
    expect(shownRatio(12.96)).toBe(12.9)
  })
})
