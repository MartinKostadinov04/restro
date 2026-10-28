// Venue settings v2 (brief SH-01 §8): the theme, the presentation and the guest features as
// stored in `venues.settings`, their readers, and what the publisher derives from the theme.
import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME } from '../snapshot/build'
import { deriveRoles, generatePalette, paletteRoles } from './derive'
import {
  canonicalFeatures,
  DEFAULT_CALL_WAITER_KINDS,
  DEFAULT_GUEST_FEATURES,
  GuestFeaturesSchema,
  PresentationSchema,
  readGuestFeatures,
  readPresentation,
} from './presentation'
import { THEME_PRESETS } from './presets'
import { validateRoles } from './roles'
import {
  paletteList,
  readVenueTheme,
  snapshotPalette,
  themePaletteOf,
  themeRolesOf,
  VenueThemeSchema,
} from './settings'

const LOGO = 'as_0123456789abcdefghijkl'

const V2 = {
  brand: '#3366cc',
  logo_asset_id: null,
  preset: 'midnight',
  colors: { primary: '#F5F1EA', secondary: '#e7e0d4', tertiary: '#e0a43a' },
  overrides: { dark: { accent_text: '#F0B656' } },
  font: 'lora',
  radius: 12,
  shadow: 0,
  scheme: 'dark',
} as const

describe('the venue theme v2', () => {
  it('reads a stored v1 row exactly as before', () => {
    expect(readVenueTheme({ theme: { brand: '#3366CC', logo_asset_id: LOGO } })).toEqual({
      brand: '#3366cc',
      logo_asset_id: LOGO,
    })
  })

  it('reads a v2 row, lower-casing every colour', () => {
    expect(readVenueTheme({ theme: V2 })).toEqual({
      ...V2,
      colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
      overrides: { dark: { accent_text: '#f0b656' } },
    })
    // Every v2 field is optional; the logo key stays required, as in v1.
    expect(readVenueTheme({ theme: { logo_asset_id: null } })).toEqual({ logo_asset_id: null })
    expect(readVenueTheme({ theme: { logo_asset_id: null, preset: null } })).toEqual({
      logo_asset_id: null,
      preset: null,
    })
  })

  it.each([
    ['no logo key', { brand: '#3366cc' }],
    ['an unknown key', { logo_asset_id: null, extra: 1 }],
    ['an unknown preset', { logo_asset_id: null, preset: 'neon' }],
    ['an unknown font', { logo_asset_id: null, font: 'comic-sans' }],
    ['a font family instead of its id', { logo_asset_id: null, font: 'Inter' }],
    ['a radius over 32', { logo_asset_id: null, radius: 33 }],
    ['a negative radius', { logo_asset_id: null, radius: -1 }],
    ['a fractional radius', { logo_asset_id: null, radius: 4.5 }],
    ['a shadow over 5', { logo_asset_id: null, shadow: 6 }],
    ['an unknown scheme', { logo_asset_id: null, scheme: 'sepia' }],
    [
      'two colours instead of three',
      { logo_asset_id: null, colors: { primary: '#ffffff', secondary: '#eeeeee' } },
    ],
    [
      'a colour name',
      {
        logo_asset_id: null,
        colors: { primary: 'white', secondary: '#eeeeee', tertiary: '#000000' },
      },
    ],
    ['an unknown role', { logo_asset_id: null, overrides: { light: { link: '#000000' } } }],
    ['an unknown scheme of overrides', { logo_asset_id: null, overrides: { sepia: {} } }],
    ['a short override colour', { logo_asset_id: null, overrides: { dark: { text: '#fff' } } }],
  ])('treats %s as no theme', (_label, theme) => {
    expect(VenueThemeSchema.safeParse(theme).success).toBe(false)
    expect(readVenueTheme({ theme })).toBeNull()
  })

  it('stores each preset as it is', () => {
    for (const preset of THEME_PRESETS) {
      const stored = readVenueTheme({
        theme: {
          logo_asset_id: null,
          preset: preset.id,
          colors: preset.colours,
          overrides: preset.overrides,
          radius: preset.radius,
        },
      })
      expect(stored?.colors).toEqual(preset.colours)
      // The eight base roles as the preset says; the extended roles (D93) come with them.
      expect(themeRolesOf(stored)).toMatchObject(preset.overrides)
    }
  })
})

describe('what the publisher derives from a theme', () => {
  it('without a theme: the default palette and its v1 roles, as DEFAULT_THEME publishes', () => {
    expect(paletteList(themePaletteOf(null))).toEqual(DEFAULT_THEME.palette)
    expect(themeRolesOf(null)).toEqual(DEFAULT_THEME.roles)
    expect(themeRolesOf({ logo_asset_id: null })).toEqual(DEFAULT_THEME.roles)
  })

  it('a v1 theme: the palette of its brand colour and the roles the shell derives from it', () => {
    const v1 = { brand: '#3366cc', logo_asset_id: null }
    expect(paletteList(themePaletteOf(v1))).toEqual(snapshotPalette('#3366cc'))
    expect(themeRolesOf(v1)).toEqual(paletteRoles(generatePalette('#3366cc')))
    expect(validateRoles(themeRolesOf(v1))).toEqual([])
  })

  it('three colours: the palette of the tertiary and deriveRoles with the overrides', () => {
    const theme = VenueThemeSchema.parse(V2)
    expect(paletteList(themePaletteOf(theme))).toEqual(snapshotPalette('#e0a43a'))
    expect(themeRolesOf(theme)).toEqual(
      deriveRoles(
        { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
        { dark: { accent_text: '#f0b656' } },
      ),
    )
    expect(themeRolesOf(theme).dark.accent_text).toBe('#f0b656')
  })

  it('lays overrides over the v1 roles too (any derived colour may be overridden, D70)', () => {
    const roles = themeRolesOf({
      brand: '#3366cc',
      logo_asset_id: null,
      overrides: { light: { border: '#123456' } },
    })
    const v1 = paletteRoles(generatePalette('#3366cc'))
    expect(roles.light).toEqual({ ...v1.light, border: '#123456' })
    expect(roles.dark).toEqual(v1.dark)
  })
})

describe('the presentation', () => {
  it('reads a template and its options', () => {
    const presentation = { face: 'editorial-market', options: { layout: 'two', compact: true } }
    expect(readPresentation({ presentation })).toEqual(presentation)
    expect(readPresentation({ presentation: { face: 'qr-phone', options: {} } })).toEqual({
      face: 'qr-phone',
      options: {},
    })
  })

  it.each([
    ['absent', {}],
    ['not an object', null],
    ['an upper-case face', { presentation: { face: 'Editorial', options: {} } }],
    [
      'a face name over 64 characters',
      { presentation: { face: `a${'-b'.repeat(32)}`, options: {} } },
    ],
    ['no options', { presentation: { face: 'editorial-market' } }],
    ['an unknown key', { presentation: { face: 'editorial-market', options: {}, theme: 'x' } }],
    ['a snake_case option key', { presentation: { face: 'f', options: { list_layout: 'two' } } }],
    [
      'an option key over 32 characters',
      { presentation: { face: 'f', options: { [`a${'b'.repeat(32)}`]: true } } },
    ],
    ['an upper-case option value', { presentation: { face: 'f', options: { layout: 'Two' } } }],
    ['a value with a space', { presentation: { face: 'f', options: { layout: 'two up' } } }],
    ['a number value', { presentation: { face: 'f', options: { columns: 2 } } }],
    [
      'a value shaped like an id',
      { presentation: { face: 'f', options: { pick: `nd_${'a'.repeat(22)}` } } },
    ],
    [
      'seventeen options',
      {
        presentation: {
          face: 'f',
          options: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`o${i}`, true])),
        },
      },
    ],
  ])('treats %s as none', (_label, settings) => {
    expect(readPresentation(settings)).toBeNull()
  })

  it('allows sixteen options', () => {
    const options = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`o${i}`, true]))
    expect(PresentationSchema.safeParse({ face: 'f', options }).success).toBe(true)
  })
})

describe('the guest features', () => {
  it('defaults to filters on and every service off', () => {
    expect(DEFAULT_GUEST_FEATURES).toEqual({
      filters: true,
      call_waiter: { enabled: false, kinds: [] },
      bill: false,
      ordering: false,
      pay: false,
    })
    expect(readGuestFeatures({})).toEqual(DEFAULT_GUEST_FEATURES)
    expect(readGuestFeatures(null)).toEqual(DEFAULT_GUEST_FEATURES)
  })

  it('reads what a venue switched on, request kinds in vocabulary order', () => {
    const features = {
      filters: false,
      call_waiter: { enabled: true, kinds: ['terminal', 'bill', 'waiter'] },
      bill: true,
      ordering: true,
      pay: false,
    }
    expect(readGuestFeatures({ guest_features: features })).toEqual({
      ...features,
      call_waiter: { enabled: true, kinds: ['waiter', 'bill', 'terminal'] },
    })
  })

  it.each([
    [
      'a missing switch',
      { filters: true, call_waiter: { enabled: false, kinds: [] }, bill: false, ordering: false },
    ],
    ['an unknown key', { ...DEFAULT_GUEST_FEATURES, tips: true }],
    [
      'an unknown request kind',
      { ...DEFAULT_GUEST_FEATURES, call_waiter: { enabled: true, kinds: ['taxi'] } },
    ],
    [
      'a repeated request kind',
      { ...DEFAULT_GUEST_FEATURES, call_waiter: { enabled: true, kinds: ['bill', 'bill'] } },
    ],
    ['a switch that is a string', { ...DEFAULT_GUEST_FEATURES, pay: 'yes' }],
  ])('falls back to the defaults for %s', (_label, features) => {
    expect(GuestFeaturesSchema.safeParse(features).success).toBe(false)
    expect(readGuestFeatures({ guest_features: features })).toEqual(DEFAULT_GUEST_FEATURES)
  })

  it('reads a list that still holds a dropped kind without it, never as a failed parse (#180)', () => {
    const stored = {
      ...DEFAULT_GUEST_FEATURES,
      call_waiter: { enabled: true, kinds: ['waiter', 'cutlery', 'water', 'other'] },
    }
    expect(GuestFeaturesSchema.safeParse(stored).success).toBe(true)
    expect(readGuestFeatures({ guest_features: stored }).call_waiter).toEqual({
      enabled: true,
      kinds: ['waiter', 'water'],
    })
  })

  it('keeps `waiter` in the list while Call a waiter is on, and only then (#180)', () => {
    const only = (enabled: boolean, kinds: string[]) =>
      readGuestFeatures({
        guest_features: { ...DEFAULT_GUEST_FEATURES, call_waiter: { enabled, kinds } },
      }).call_waiter
    expect(only(true, ['water'])).toEqual({ enabled: true, kinds: ['waiter', 'water'] })
    expect(only(true, ['other'])).toEqual({ enabled: true, kinds: ['waiter'] })
    expect(only(false, ['water'])).toEqual({ enabled: false, kinds: ['water'] })
  })

  it('offers the card terminal off when the feature is switched on (#180)', () => {
    expect(DEFAULT_CALL_WAITER_KINDS).toEqual([
      'waiter',
      'bill',
      'ice',
      'water',
      'glasses',
      'clean_table',
    ])
  })

  it('accepts all seven request kinds, once each', () => {
    const kinds = ['waiter', 'bill', 'ice', 'water', 'glasses', 'clean_table', 'terminal'] as const
    const features = {
      ...DEFAULT_GUEST_FEATURES,
      call_waiter: { enabled: true, kinds: [...kinds] },
    }
    expect(GuestFeaturesSchema.safeParse(features).success).toBe(true)
    expect(canonicalFeatures(features)).toEqual(features)
  })
})
