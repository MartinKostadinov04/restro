// The designer's four themes as starting points (D70, brief SH-01 §6). Values taken exactly from
// the Editorial Market delivery, `docs/design/faces/editorial-market/2026-10-11/source/fixtures/
// themes/presets.json` (reference only, never imported): the three venue colours are the light
// scheme's background, surface and accent; every role of both schemes is an override, so a preset
// shows exactly the designer's colours. Hex values are lower-cased (the JSON has upper case);
// the JSON's camelCase `onAccent`/`accentText` are `on_accent`/`accent_text` here.
//
// Every preset passes `REQUIRED_PAIRS` in both schemes as delivered (presets.test.ts): no value
// had to change.

import type { RoleOverrides, ThemeColours, ThemeRoleSet, ThemeRoles } from './roles'

/** The preset ids, in the designer's order. */
export const THEME_PRESET_IDS = ['botanical', 'midnight', 'nordic', 'terracotta'] as const

/** One preset id. */
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]

/**
 * A starting point: its name, three colours, the designer's 16 roles and corner radius. The
 * overrides are typed as a full role set too: every role of both schemes is there.
 */
export interface ThemePreset {
  readonly id: ThemePresetId
  readonly label: { readonly bg: string; readonly en: string }
  readonly colours: ThemeColours
  readonly overrides: Required<RoleOverrides> & ThemeRoleSet
  readonly radius: number
}

function preset(
  id: ThemePresetId,
  label: ThemePreset['label'],
  radius: number,
  light: ThemeRoles,
  dark: ThemeRoles,
): ThemePreset {
  return Object.freeze({
    id,
    label: Object.freeze(label),
    colours: Object.freeze({
      primary: light.background,
      secondary: light.surface,
      tertiary: light.accent,
    }),
    overrides: Object.freeze({ light: Object.freeze(light), dark: Object.freeze(dark) }),
    radius,
  })
}

/** The four presets, in `THEME_PRESET_IDS` order. */
export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  preset(
    'botanical',
    { bg: 'Ботаника', en: 'Botanical' },
    14,
    {
      background: '#f4efe6',
      surface: '#e8dfcf',
      accent: '#d9f26b',
      on_accent: '#1f3a2b',
      text: '#1f3a2b',
      muted: '#4f5b50',
      accent_text: '#2f6b3f',
      border: '#d8cdb8',
    },
    {
      background: '#13201a',
      surface: '#1d2e25',
      accent: '#d9f26b',
      on_accent: '#13201a',
      text: '#f1ece0',
      muted: '#b9c2b5',
      accent_text: '#d9f26b',
      border: '#2e4236',
    },
  ),
  preset(
    'midnight',
    { bg: 'Полунощ', en: 'Midnight' },
    6,
    {
      background: '#f5f1ea',
      surface: '#e7e0d4',
      accent: '#e0a43a',
      on_accent: '#1a1410',
      text: '#1a1410',
      muted: '#5a5048',
      accent_text: '#8a5a12',
      border: '#d9d0c2',
    },
    {
      background: '#0e0d0c',
      surface: '#1c1a18',
      accent: '#e0a43a',
      on_accent: '#0e0d0c',
      text: '#f3ebdd',
      muted: '#b5ab9c',
      accent_text: '#f0b656',
      border: '#2e2a26',
    },
  ),
  preset(
    'nordic',
    { bg: 'Скандинавски', en: 'Nordic' },
    4,
    {
      background: '#fafbfc',
      surface: '#eef1f4',
      accent: '#2f5bea',
      on_accent: '#ffffff',
      text: '#1e2329',
      muted: '#555e69',
      accent_text: '#2348c4',
      border: '#dde2e8',
    },
    {
      background: '#12161b',
      surface: '#1c222a',
      accent: '#6e8eff',
      on_accent: '#0b0f14',
      text: '#eef2f6',
      muted: '#a9b3bf',
      accent_text: '#8ea8ff',
      border: '#2a323c',
    },
  ),
  preset(
    'terracotta',
    { bg: 'Теракота', en: 'Terracotta' },
    18,
    {
      background: '#fbf5ec',
      surface: '#f0e2d2',
      accent: '#c8372d',
      on_accent: '#ffffff',
      text: '#2b1b14',
      muted: '#6a5246',
      accent_text: '#a62c23',
      border: '#e4d3c0',
    },
    {
      background: '#1c1310',
      surface: '#2a1d18',
      accent: '#e5533f',
      on_accent: '#1c1310',
      text: '#f6ebdd',
      muted: '#c4afa0',
      accent_text: '#f07a66',
      border: '#3d2b24',
    },
  ),
])

/** The preset with this id, or undefined. */
export function themePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((entry) => entry.id === id)
}
