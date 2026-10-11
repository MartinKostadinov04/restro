// The Design tab's form state and everything worked out from it (brief SH-05a). Pure: no React,
// no I/O, so the rules of the tab are tested without a screen.
//
// A look has one of two sources (D70): the three colours (primary ~60% the page, secondary ~30%
// the panels, tertiary ~10% the highlights) or, for a venue that still uses the old way, one brand
// colour. The eight roles of both screens are derived from either (`themeRolesOf`, the same
// function the publisher uses, so the tab shows what guests will see), and any role may be set by
// hand (an override). The state keeps every colour as the TEXT the person typed, so half a colour
// in a box is a field the tab can point at, not a value that vanishes.
import {
  DEFAULT_FONT_ID,
  DEFAULT_THEME,
  FALLBACK_BRAND,
  type HarmonyRule,
  type PairIssue,
  REQUIRED_PAIRS,
  ROLE_MODES,
  ROLE_NAMES,
  type RoleMode,
  type RoleName,
  suggestHarmony,
  THEME_PRESETS,
  type ThemeFontId,
  type ThemePresetId,
  type ThemeRoleSet,
  type ThemeScheme,
  themePreset,
  themeRolesOf,
  type VenueTheme,
  validateRoles,
} from '@restro/core'

import { normaliseHex } from './hex'

/** The three colours a venue chooses (D70). */
export type ColourKey = 'primary' | 'secondary' | 'tertiary'

/** The colours, in the order the tab shows them. */
export const COLOUR_KEYS: readonly ColourKey[] = ['primary', 'secondary', 'tertiary']

/** The roles set by hand, per screen, as typed. */
export type RoleTexts = { readonly [M in RoleMode]: Readonly<Partial<Record<RoleName, string>>> }

/** Everything the form holds. */
export interface LookState {
  /** `colours`: the three colours (D70). `brand`: one brand colour, the way the first version worked. */
  readonly source: 'brand' | 'colours'
  /** The preset this look started from (only with `colours`); null for custom. */
  readonly preset: ThemePresetId | null
  /** The brand colour as typed; empty = none (the neutral default look). */
  readonly brand: string
  /** The three colours as typed. */
  readonly colours: Readonly<Record<ColourKey, string>>
  readonly overrides: RoleTexts
  readonly font: ThemeFontId
  readonly radius: number
  readonly shadow: number
  readonly scheme: ThemeScheme
  readonly logoAssetId: string | null
}

const NO_OVERRIDES: RoleTexts = { light: {}, dark: {} }

/** The three colours of a look that starts from one brand colour (or the neutral grey). */
function coloursFromBrand(brand: string): Record<ColourKey, string> {
  return suggestHarmony(normaliseHex(brand) ?? FALLBACK_BRAND, 'monochrome')
}

/** The form state of a saved look (null = the venue has none: the default look). */
export function lookStateOf(theme: VenueTheme | null): LookState {
  const colours = theme?.colors
  return {
    source: colours === undefined ? 'brand' : 'colours',
    preset: colours === undefined ? null : (theme?.preset ?? null),
    brand: theme?.brand ?? '',
    colours: colours ?? coloursFromBrand(theme?.brand ?? ''),
    overrides: {
      light: { ...theme?.overrides?.light },
      dark: { ...theme?.overrides?.dark },
    },
    font: theme?.font ?? DEFAULT_FONT_ID,
    radius: theme?.radius ?? DEFAULT_THEME.radius,
    shadow: theme?.shadow ?? DEFAULT_THEME.shadow,
    scheme: theme?.scheme ?? 'auto',
    logoAssetId: theme?.logo_asset_id ?? null,
  }
}

// --- From the form to a look ---------------------------------------------------------------------

/** A field that is not a colour yet: `brand`, a colour key, or `<screen>.<role>`. */
export type InvalidField = 'brand' | ColourKey | `${RoleMode}.${RoleName}`

/** What the form works out to. */
export interface LookView {
  /** The whole look to save, or null while some field is not a colour. */
  readonly theme: VenueTheme | null
  readonly invalid: readonly InvalidField[]
  /** The eight roles of both screens as guests will get them (overrides included). */
  readonly roles: ThemeRoleSet | null
  /** The same without any override: what "Reset to derived" goes back to. */
  readonly derived: ThemeRoleSet | null
  /** The text-on-colour pairs that do not read. */
  readonly issues: readonly PairIssue[]
}

/** A form state that works out to a whole look. */
export type ValidLook = LookView & {
  readonly theme: VenueTheme
  readonly roles: ThemeRoleSet
  readonly derived: ThemeRoleSet
}

/** True when the form state works out to a whole look. */
export function isValidLook(view: LookView): view is ValidLook {
  return view.theme !== null && view.roles !== null && view.derived !== null
}

/** The whole look of a form state: every v2 field, so a save can never be partial. */
export function lookViewOf(state: LookState): LookView {
  const invalid: InvalidField[] = []
  const brand = normaliseHex(state.brand)
  if (state.source === 'brand' && state.brand.trim() !== '' && brand === null) invalid.push('brand')

  const colours = {} as Record<ColourKey, string>
  for (const key of COLOUR_KEYS) {
    const hex = normaliseHex(state.colours[key])
    if (hex === null) {
      if (state.source === 'colours') invalid.push(key)
    } else {
      colours[key] = hex
    }
  }

  const overrides: { -readonly [M in RoleMode]?: Partial<Record<RoleName, string>> } = {}
  for (const mode of ROLE_MODES) {
    const own: Partial<Record<RoleName, string>> = {}
    for (const role of ROLE_NAMES) {
      const text = state.overrides[mode][role]
      if (text === undefined) continue
      const hex = normaliseHex(text)
      if (hex === null) invalid.push(`${mode}.${role}`)
      else own[role] = hex
    }
    if (Object.keys(own).length > 0) overrides[mode] = own
  }

  if (invalid.length > 0) {
    return { theme: null, invalid, roles: null, derived: null, issues: [] }
  }

  const theme: VenueTheme = {
    logo_asset_id: state.logoAssetId,
    ...(state.source === 'brand'
      ? brand === null
        ? {}
        : { brand }
      : { preset: state.preset, colors: colours }),
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    font: state.font,
    radius: state.radius,
    shadow: state.shadow,
    scheme: state.scheme,
  }
  const roles = themeRolesOf(theme)
  const { overrides: _own, ...plain } = theme
  return {
    theme,
    invalid,
    roles,
    derived: themeRolesOf(plain),
    issues: validateRoles(roles),
  }
}

// --- Starting points -----------------------------------------------------------------------------

/**
 * Takes over from a preset. A preset pins all 16 roles to the designer's values; as soon as the
 * person changes the colours those pins would hold the new colours back (the page would stay
 * Midnight's whatever primary is chosen). So the preset's own values are released and the colours
 * derive the roles again; anything the person set by hand (a value different from the preset's)
 * stays. The look is then custom.
 */
function takeOver(state: LookState): LookState {
  if (state.preset === null) return state
  const preset = themePreset(state.preset)
  if (preset === undefined) return { ...state, preset: null }
  const release = (mode: RoleMode): Partial<Record<RoleName, string>> => {
    const kept: Partial<Record<RoleName, string>> = {}
    for (const role of ROLE_NAMES) {
      const text = state.overrides[mode][role]
      if (text !== undefined && normaliseHex(text) !== preset.overrides[mode][role]) {
        kept[role] = text
      }
    }
    return kept
  }
  return { ...state, preset: null, overrides: { light: release('light'), dark: release('dark') } }
}

/** Starts from one of the designer's presets: its three colours, its 16 roles and its corners. */
export function startFromPreset(state: LookState, id: ThemePresetId): LookState {
  const preset = THEME_PRESETS.find((entry) => entry.id === id)
  if (preset === undefined) return state
  return {
    ...state,
    source: 'colours',
    preset: id,
    colours: { ...preset.colours },
    overrides: { light: { ...preset.overrides.light }, dark: { ...preset.overrides.dark } },
    radius: preset.radius,
  }
}

/** Starts from one brand colour, the way the first version of the look worked. */
export function startFromBrand(state: LookState): LookState {
  return { ...state, source: 'brand', preset: null, overrides: NO_OVERRIDES }
}

/** Starts from the venue's own three colours: only they (and what is set by hand) decide. */
export function startCustom(state: LookState): LookState {
  if (state.source === 'colours') return takeOver(state)
  return {
    ...state,
    source: 'colours',
    preset: null,
    colours: coloursFromBrand(state.brand),
    overrides: NO_OVERRIDES,
  }
}

/** Sets one of the three colours as typed. */
export function setColour(state: LookState, key: ColourKey, text: string): LookState {
  const taken = takeOver(state)
  return { ...taken, colours: { ...taken.colours, [key]: text } }
}

/** The colour the "suggest with colour theory" menu starts from: the tertiary, else the brand colour. */
export function harmonySeed(state: LookState): string {
  const text = state.source === 'colours' ? state.colours.tertiary : state.brand
  return normaliseHex(text) ?? FALLBACK_BRAND
}

/** Fills the three colours by a harmony rule, seeded from the current tertiary (it stays as it is). */
export function applyHarmony(state: LookState, rule: HarmonyRule): LookState {
  const colours = suggestHarmony(harmonySeed(state), rule)
  if (state.source === 'brand') {
    return { ...state, source: 'colours', preset: null, colours, overrides: NO_OVERRIDES }
  }
  return { ...takeOver(state), colours }
}

// --- Roles set by hand ---------------------------------------------------------------------------

/** Sets one role of one screen by hand, as typed. */
export function setOverride(
  state: LookState,
  mode: RoleMode,
  role: RoleName,
  text: string,
): LookState {
  return {
    ...state,
    overrides: { ...state.overrides, [mode]: { ...state.overrides[mode], [role]: text } },
  }
}

/** Takes the hand-set colour off one role: it is derived again. */
export function clearOverride(state: LookState, mode: RoleMode, role: RoleName): LookState {
  const { [role]: _removed, ...rest } = state.overrides[mode]
  return { ...state, overrides: { ...state.overrides, [mode]: rest } }
}

/** True when the role of that screen is set by hand (or comes from the preset the look started from). */
export function isOverridden(state: LookState, mode: RoleMode, role: RoleName): boolean {
  return state.overrides[mode][role] !== undefined
}

/** True when the hand-set colour of a role is exactly the value the preset gives it. */
export function isFromPreset(state: LookState, mode: RoleMode, role: RoleName): boolean {
  if (state.preset === null) return false
  const text = state.overrides[mode][role]
  const preset = themePreset(state.preset)
  return (
    text !== undefined &&
    preset !== undefined &&
    normaliseHex(text) === preset.overrides[mode][role]
  )
}

// --- Pairs ---------------------------------------------------------------------------------------

/** One text-on-colour pair a role takes part in. */
export interface RolePair {
  readonly fg: RoleName
  readonly bg: RoleName
  readonly min: number
  /** The other role of the pair, as seen from the role asked about. */
  readonly other: RoleName
}

/** The required pairs a role is part of (as the text or as what the text sits on). */
export function pairsOfRole(role: RoleName): RolePair[] {
  return REQUIRED_PAIRS.filter((pair) => pair.fg === role || pair.bg === role).map((pair) => ({
    fg: pair.fg,
    bg: pair.bg,
    min: pair.min,
    other: pair.fg === role ? pair.bg : pair.fg,
  }))
}

/** A ratio as shown: rounded DOWN to one decimal, so 4.47 never reads as the passing 4.5. */
export function shownRatio(ratio: number): number {
  return Math.floor(ratio * 10) / 10
}
