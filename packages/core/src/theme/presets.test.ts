// The designer's four themes (brief SH-01 §6): each a valid starting point that reads in both
// schemes exactly as delivered.
import { describe, expect, it } from 'vitest'

import { deriveRoles } from './derive'
import { THEME_PRESET_IDS, THEME_PRESETS, themePreset } from './presets'
import { ROLE_NAMES, ThemeRolesSchema, validateRoles } from './roles'
import { VenueThemeSchema } from './settings'

describe('THEME_PRESETS', () => {
  it('lists the four presets in the designer order, with BG and EN labels', () => {
    expect(THEME_PRESET_IDS).toEqual(['botanical', 'midnight', 'nordic', 'terracotta'])
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([...THEME_PRESET_IDS])
    expect(THEME_PRESETS.map((preset) => preset.label)).toEqual([
      { bg: 'Ботаника', en: 'Botanical' },
      { bg: 'Полунощ', en: 'Midnight' },
      { bg: 'Скандинавски', en: 'Nordic' },
      { bg: 'Теракота', en: 'Terracotta' },
    ])
    expect(THEME_PRESETS.map((preset) => preset.radius)).toEqual([14, 6, 4, 18])
  })

  it.each(THEME_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s passes every required pair in both schemes',
    (_id, preset) => {
      expect(validateRoles(preset.overrides)).toEqual([])
      // Through deriveRoles too: every role is an override, so the designer's colours stand.
      expect(deriveRoles(preset.colours, preset.overrides)).toEqual(preset.overrides)
    },
  )

  it.each(THEME_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s takes its three colours from the light page, panels and accent, and sets all 16 roles',
    (_id, preset) => {
      expect(preset.colours).toEqual({
        primary: preset.overrides.light.background,
        secondary: preset.overrides.light.surface,
        tertiary: preset.overrides.light.accent,
      })
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(preset.overrides[mode])).toEqual([...ROLE_NAMES])
        expect(ThemeRolesSchema.safeParse(preset.overrides[mode]).success).toBe(true)
      }
      // A preset stores as a venue theme as it is.
      const theme = VenueThemeSchema.parse({
        logo_asset_id: null,
        preset: preset.id,
        colors: preset.colours,
        overrides: preset.overrides,
        radius: preset.radius,
      })
      expect(theme.overrides).toEqual(preset.overrides)
    },
  )

  it('keeps the designer values (spot checks against presets.json)', () => {
    expect(themePreset('botanical')?.overrides.light).toMatchObject({
      background: '#f4efe6',
      accent: '#d9f26b',
      text: '#1f3a2b',
    })
    expect(themePreset('midnight')?.overrides.dark).toMatchObject({
      background: '#0e0d0c',
      accent: '#e0a43a',
      text: '#f3ebdd',
    })
    expect(themePreset('nordic')?.overrides.dark.accent).toBe('#6e8eff')
    expect(themePreset('terracotta')?.overrides.light.accent).toBe('#c8372d')
    expect(themePreset('unknown')).toBeUndefined()
  })

  it('cannot be changed at run time', () => {
    const preset = THEME_PRESETS[0]
    expect(Object.isFrozen(THEME_PRESETS)).toBe(true)
    expect(Object.isFrozen(preset?.overrides.light)).toBe(true)
  })
})
