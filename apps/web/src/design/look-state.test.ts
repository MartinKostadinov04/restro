// The Design tab's form rules (briefs SH-05a and S7, D70, D92, D93): a brand-first look, what the
// form works out to, and that it is always a WHOLE look that passes the readability check or is
// refused.
import {
  DEFAULT_PALETTE,
  EXTENDED_PAIRS,
  EXTENDED_ROLE_NAMES,
  generatePalette,
  HARMONY_RULES,
  hslToHex,
  REQUIRED_PAIRS,
  ROLE_NAMES,
  semanticColours,
  suggestHarmony,
  THEME_PRESETS,
  themeRolesOf,
  VenueThemeSchema,
  validateRoles,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  applyHarmony,
  chromaOf,
  clearAllOverrides,
  clearOverride,
  followBrand,
  hasOwnTints,
  isBrandOnlyLook,
  isOverridden,
  isStronglySaturated,
  isValidLook,
  lookStateOf,
  lookViewOf,
  pairsOfExtendedRole,
  pairsOfRole,
  paleHighlightScreens,
  STRONG_PAGE_CHROMA,
  setBrand,
  setColour,
  setOverride,
  shownRatio,
  tintsOf,
} from './look-state'

const NONE = lookStateOf(null)

/** Brand colours of every kind: calm, vivid, pale, dark, grey. */
const BRANDS = [
  '#e11d48',
  '#f97316',
  '#eab308',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#6b7280',
  '#00ff00',
  '#ffff00',
  '#1e3a8a',
] as const

/** The look of a form state, which must be whole. */
function themeOf(state: ReturnType<typeof lookStateOf>) {
  const view = lookViewOf(state)
  if (!isValidLook(view)) throw new Error(`not a whole look: ${view.invalid.join()}`)
  return view
}

describe('the form state of a saved look', () => {
  it('starts a venue with no look on the default look: no brand colour, neutral page and panels', () => {
    expect(NONE.colours.tertiary).toBe('')
    expect(NONE.colours.primary).toBe(semanticColours(DEFAULT_PALETTE).background)
    expect(NONE.colours.secondary).toBe('#ffffff')
    expect(NONE.edited).toEqual({ primary: false, secondary: false })
    expect(NONE.scheme).toBe('auto')
    expect(NONE.font).toBe('inter')
    // Nothing is saved but the look's own settings: no colours, so the palette it has always
    // published stays (a venue that only changes its font does not change its colours).
    const view = themeOf(NONE)
    expect(view.theme).toEqual({
      logo_asset_id: null,
      font: 'inter',
      radius: 8,
      shadow: 1,
      scheme: 'auto',
    })
    expect(view.issues).toEqual([])
  })

  it('loads a brand-only look as its brand colour with the page and panels it always had', () => {
    const theme = { brand: '#2563eb', logo_asset_id: 'as_0123456789ABCDEFGHIJKL' }
    const state = lookStateOf(theme)
    const light = semanticColours(generatePalette('#2563eb'))
    expect(isBrandOnlyLook(theme)).toBe(true)
    expect(state.colours).toEqual({
      primary: light.background.toLowerCase(),
      secondary: light.surface.toLowerCase(),
      tertiary: '#2563eb',
    })
    expect(state.edited).toEqual({ primary: false, secondary: false })
    expect(state.logoAssetId).toBe('as_0123456789ABCDEFGHIJKL')
    // Saved from the form it is the three colours, never the brand colour.
    const saved = themeOf(state).theme
    expect(saved).toMatchObject({
      preset: null,
      colors: { primary: light.background, secondary: light.surface, tertiary: '#2563eb' },
      logo_asset_id: 'as_0123456789ABCDEFGHIJKL',
    })
    expect(saved).not.toHaveProperty('brand')
  })

  it('knows a look that is not the old way', () => {
    expect(isBrandOnlyLook(null)).toBe(false)
    expect(isBrandOnlyLook({ logo_asset_id: null })).toBe(false)
    expect(
      isBrandOnlyLook({
        logo_asset_id: null,
        preset: null,
        colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      }),
    ).toBe(false)
  })

  it('round-trips a three-colour look through the form, and marks a page that is not the brand’s tint as the person’s', () => {
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
    const state = lookStateOf(saved)
    expect(state.edited).toEqual({ primary: true, secondary: true })
    const view = themeOf(state)
    expect(view.theme).toEqual(saved)
    expect(view.roles).toEqual(themeRolesOf(saved))
  })

  it('knows a page that is still the brand’s tint, so the brand colour goes on filling it', () => {
    const tints = tintsOf('#2563eb')
    const state = lookStateOf({
      logo_asset_id: null,
      preset: null,
      colors: { primary: tints.page, secondary: tints.panels, tertiary: '#2563eb' },
    })
    expect(state.edited).toEqual({ primary: false, secondary: false })
  })

  it.each(THEME_PRESETS)(
    'loads a look saved from the preset $id as its three colours and roles',
    (preset) => {
      const saved = VenueThemeSchema.parse({
        logo_asset_id: null,
        preset: preset.id,
        colors: preset.colours,
        overrides: preset.overrides,
        font: 'inter',
        radius: preset.radius,
        shadow: 1,
        scheme: 'auto',
      })
      const state = lookStateOf(saved)
      expect(state.colours).toEqual(preset.colours)
      expect(state.overrides).toEqual(preset.overrides)
      // Saved again it is the same look and the same roles, with no preset named.
      const view = themeOf(state)
      expect(view.theme).toEqual({ ...saved, preset: null })
      expect(view.roles).toEqual(themeRolesOf(saved))
      expect(view.issues).toEqual([])
    },
  )

  it('always builds every v2 field, so a save can never be partial', () => {
    for (const state of [NONE, setBrand(NONE, '#7c3aed'), setColour(NONE, 'primary', '#f4efe6')]) {
      const { theme } = themeOf(state)
      expect(theme).toHaveProperty('font')
      expect(theme).toHaveProperty('radius')
      expect(theme).toHaveProperty('shadow')
      expect(theme).toHaveProperty('scheme')
      expect(theme).toHaveProperty('logo_asset_id')
      expect(theme).not.toHaveProperty('brand')
      expect(VenueThemeSchema.safeParse(theme).success).toBe(true)
    }
  })
})

describe('brand-first: the brand colour fills the page and the panels', () => {
  it('pre-fills them with the palette’s light page and panels', () => {
    for (const brand of BRANDS) {
      const state = setBrand(NONE, brand)
      const light = semanticColours(generatePalette(brand))
      expect(state.colours.primary, brand).toBe(light.background.toLowerCase())
      expect(state.colours.secondary, brand).toBe(light.surface.toLowerCase())
      expect(state.colours.tertiary).toBe(brand)
    }
  })

  it('saves the three colours with no preset and no brand colour, and they read on both screens', () => {
    for (const brand of BRANDS) {
      const view = themeOf(setBrand(NONE, brand))
      expect(view.theme).toMatchObject({ preset: null, colors: { tertiary: brand } })
      expect(view.theme).not.toHaveProperty('brand')
      expect(view.issues, brand).toEqual([])
    }
  })

  it('takes a brand colour as typed in the forms people type, and keeps half a colour as typed', () => {
    expect(setBrand(NONE, '2563EB').colours.primary).toBe(tintsOf('#2563eb').page)
    const half = setBrand(setBrand(NONE, '#2563eb'), '#25')
    // The page and the panels keep the last whole tints while the brand box holds half a colour.
    expect(half.colours.primary).toBe(tintsOf('#2563eb').page)
    expect(half.colours.tertiary).toBe('#25')
    const view = lookViewOf(half)
    expect(view.theme).toBeNull()
    expect(view.invalid).toEqual(['tertiary'])
    expect(isValidLook(view)).toBe(false)
  })

  it('takes the neutral tints back, and the look back to the default, when the box is emptied', () => {
    const state = setBrand(setBrand(NONE, '#2563eb'), '')
    expect(state.colours.primary).toBe(NONE.colours.primary)
    expect(state.colours.secondary).toBe(NONE.colours.secondary)
    expect(themeOf(state).theme).not.toHaveProperty('colors')
  })

  it('stops filling a colour once the person has set it, and fills the other still', () => {
    let state = setBrand(NONE, '#2563eb')
    state = setColour(state, 'primary', '#f4efe6')
    expect(state.edited).toEqual({ primary: true, secondary: false })
    state = setBrand(state, '#e11d48')
    expect(state.colours.primary).toBe('#f4efe6')
    expect(state.colours.secondary).toBe(tintsOf('#e11d48').panels)
    expect(hasOwnTints(state)).toBe(true)
  })

  it('"Follow the brand colour" hands both back', () => {
    let state = setBrand(NONE, '#2563eb')
    state = setColour(setColour(state, 'primary', '#f4efe6'), 'secondary', '#e8dfcf')
    const back = followBrand(state)
    expect(back.colours.primary).toBe(tintsOf('#2563eb').page)
    expect(back.colours.secondary).toBe(tintsOf('#2563eb').panels)
    expect(back.edited).toEqual({ primary: false, secondary: false })
    expect(hasOwnTints(back)).toBe(false)
    // …and then the brand colour fills them again.
    expect(setBrand(back, '#e11d48').colours.primary).toBe(tintsOf('#e11d48').page)
  })

  it('a page set by hand with no brand colour chosen is a look of its own (the grey highlight)', () => {
    const view = themeOf(setColour(NONE, 'primary', '#f4efe6'))
    expect(view.theme).toMatchObject({
      preset: null,
      colors: { primary: '#f4efe6', secondary: '#ffffff', tertiary: '#6b7280' },
    })
  })

  it('marks a page that is not a colour and holds the whole look back', () => {
    const state = setColour(setBrand(NONE, '#2563eb'), 'primary', '#12')
    const view = lookViewOf(state)
    expect(view.theme).toBeNull()
    expect(view.invalid).toEqual(['primary'])
    expect(state.colours.primary).toBe('#12')
  })

  it('lets a colour chosen with a picker through an older pin of that role', () => {
    // A look from a preset pinned the light page, panels and highlight; choosing new ones releases
    // the pins, or the new colours would not show.
    const midnight = THEME_PRESETS.find((preset) => preset.id === 'midnight')
    if (midnight === undefined) throw new Error('the Midnight preset is in core')
    let state = lookStateOf(
      VenueThemeSchema.parse({
        logo_asset_id: null,
        preset: 'midnight',
        colors: midnight.colours,
        overrides: midnight.overrides,
        font: 'inter',
        radius: 6,
        shadow: 1,
        scheme: 'auto',
      }),
    )
    state = setBrand(setColour(state, 'primary', '#eeeeff'), '#2563eb')
    const view = themeOf(state)
    expect(view.roles.light.background).toBe('#eeeeff')
    expect(view.roles.light.accent).toBe('#2563eb')
    // The dark screen’s pins stay, as hand-set colours the person can reset.
    expect(isOverridden(state, 'dark', 'background')).toBe(true)
  })
})

describe('a strongly saturated page', () => {
  it('is warned about above the engine’s own calm tints, and only then', () => {
    expect(isStronglySaturated('#ffcc00')).toBe(true)
    expect(isStronglySaturated('#e11d48')).toBe(true)
    expect(isStronglySaturated('#c0d8ff')).toBe(true)
    expect(isStronglySaturated('#f4efe6')).toBe(false)
    expect(isStronglySaturated('#ffffff')).toBe(false)
    expect(isStronglySaturated('#111111')).toBe(false)
    // Half a colour is the box's problem, not a saturation warning.
    expect(isStronglySaturated('#12')).toBe(false)
    expect(isStronglySaturated('')).toBe(false)
  })

  it('is above every page the engine’s harmony helpers and the brand-first pre-fill give', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      const seed = hslToHex(hue, 1, 0.5)
      for (const rule of HARMONY_RULES) {
        const { primary, secondary } = suggestHarmony(seed, rule)
        expect(chromaOf(primary), `${rule} page at ${hue}`).toBeLessThan(STRONG_PAGE_CHROMA)
        expect(chromaOf(secondary), `${rule} panels at ${hue}`).toBeLessThan(STRONG_PAGE_CHROMA)
      }
      expect(isStronglySaturated(tintsOf(seed).page), `pre-fill at ${hue}`).toBe(false)
    }
    // The pre-fill never warns for the colours people pick for a brand either.
    for (const brand of BRANDS) expect(isStronglySaturated(tintsOf(brand).page), brand).toBe(false)
  })
})

describe('"suggest with colour theory"', () => {
  it.each(HARMONY_RULES)('%s fills the page and the panels from the brand colour', (rule) => {
    const start = setBrand(NONE, '#7c3aed')
    const state = applyHarmony(start, rule)
    expect(state.colours).toEqual(suggestHarmony('#7c3aed', rule))
    // The brand colour stays exactly as chosen, and the person's now are the page and the panels.
    expect(state.colours.tertiary).toBe('#7c3aed')
    expect(state.edited).toEqual({ primary: true, secondary: true })
    // Derived roles always read, whatever the rule gave.
    expect(themeOf(state).issues).toEqual([])
  })

  it('starts from the neutral grey when no brand colour is chosen', () => {
    const state = applyHarmony(NONE, 'triadic')
    expect(state.colours).toEqual(suggestHarmony('#6b7280', 'triadic'))
  })
})

describe('the highlight against the page', () => {
  it('names the screens on which it stands out less than 3:1 (D93 point 2)', () => {
    // A pale yellow brand on its own pale page does not stand out in the light screen…
    const pale = themeOf(setBrand(NONE, '#eab308'))
    expect(paleHighlightScreens(pale.roles)).toContain('light')
    // …and a deep blue does on both.
    const deep = themeOf(setBrand(NONE, '#1e3a8a'))
    expect(paleHighlightScreens(deep.roles)).toEqual([])
  })
})

describe('roles set by hand', () => {
  it('lays an override over the derived role and reports a pair that does not read', () => {
    const state = setOverride(setBrand(NONE, '#16a34a'), 'light', 'text', '#e9fcf0')
    const view = themeOf(state)
    expect(view.roles.light.text).toBe('#e9fcf0')
    // Text the colour of the page: it fails against the page and the panels, in the light set only.
    expect(view.issues.map((i) => `${i.mode}:${i.fg}-on-${i.bg}`)).toEqual([
      'light:text-on-background',
      'light:text-on-surface',
    ])
    expect(view.issues).toEqual(validateRoles(view.roles))
  })

  it('"Reset" takes the override off and the role is derived again', () => {
    const base = setBrand(NONE, '#16a34a')
    const broken = setOverride(base, 'light', 'text', '#e9fcf0')
    expect(isOverridden(broken, 'light', 'text')).toBe(true)
    const reset = clearOverride(broken, 'light', 'text')
    expect(isOverridden(reset, 'light', 'text')).toBe(false)
    const view = themeOf(reset)
    expect(view.roles.light.text).toBe(view.derived.light.text)
    expect(view.issues).toEqual([])
  })

  it('takes every override off at once', () => {
    const state = setOverride(
      setOverride(NONE, 'light', 'border', '#abcdef'),
      'dark',
      'muted',
      '#999999',
    )
    expect(clearAllOverrides(state).overrides).toEqual({ light: {}, dark: {} })
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

  it('lists the pairs of the roles D93 added', () => {
    expect(pairsOfExtendedRole('error_text').map((p) => `${p.other}:${p.min}`)).toEqual([
      'background:4.5',
      'surface:4.5',
    ])
    expect(pairsOfExtendedRole('selected').map((p) => p.other)).toEqual(['selected_text'])
    expect(pairsOfExtendedRole('backdrop')).toEqual([])
    // Every extended pair is shown from its extended role: once from the text side, and the one
    // pair whose fill is an extended role too (selected text on selected) once more from there.
    const seen = EXTENDED_ROLE_NAMES.flatMap((role) => pairsOfExtendedRole(role)).length
    expect(seen).toBe(EXTENDED_PAIRS.length + 1)
  })

  it('shows a ratio rounded down, so 4.49 never reads as the passing 4.5', () => {
    expect(shownRatio(4.49)).toBe(4.4)
    expect(shownRatio(4.5)).toBe(4.5)
    expect(shownRatio(12.96)).toBe(12.9)
  })
})
