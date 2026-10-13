// The Design tab's form state and everything worked out from it (briefs SH-05a and S7). Pure: no
// React, no I/O, so the rules of the tab are tested without a screen.
//
// A look is brand-first (D92, D93): the person gives "Your brand colour", which is the engine's
// Tertiary (the ~10% highlights), and the page (Primary, ~60%) and the panels (Secondary, ~30%) are
// pre-filled as calm tints of it. Page and panels stay editable; once the person has set one, the
// brand colour no longer fills it. All eight roles of both screens, and the ten of D93, are derived
// from the three colours (`themeRolesOf`, the same function the publisher uses, so the tab shows
// what guests will see), and any of the eight base roles may be set by hand (an override). The
// state keeps every colour as the TEXT the person typed, so half a colour in a box is a field the
// tab can point at, not a value that vanishes.
//
// A look that is saved the old way loads as its three colours: a brand-only look as its brand
// colour with the tints it always had in the light screen, a preset look as its colours and the
// roles it pinned. The form never saves a preset or a brand colour any more: it saves `colors` with
// `preset: null` and the overrides.
import {
  type AnyRoleName,
  contrastRatio,
  DEFAULT_FONT_ID,
  DEFAULT_PALETTE,
  DEFAULT_THEME,
  EXTENDED_PAIRS,
  type ExtendedRoleName,
  FALLBACK_BRAND,
  generatePalette,
  type HarmonyRule,
  hexToOklch,
  MIN_CONTROL_CONTRAST,
  type PairIssue,
  REQUIRED_PAIRS,
  ROLE_MODES,
  ROLE_NAMES,
  type RoleMode,
  type RoleName,
  semanticColours,
  suggestHarmony,
  type ThemeColours,
  type ThemeFontId,
  type ThemeRoleSet,
  type ThemeScheme,
  themeRolesOf,
  type VenueTheme,
  validateRoles,
} from '@restro/core'

import { normaliseHex } from './hex'

/** The three colours of a look (D70), by the engine's names. */
export type ColourKey = 'primary' | 'secondary' | 'tertiary'

/** The colours, in the order the engine lists them. The tab shows the brand colour (tertiary) first. */
export const COLOUR_KEYS: readonly ColourKey[] = ['primary', 'secondary', 'tertiary']

/** The two colours the brand colour fills in until the person sets them. */
export type FilledKey = 'primary' | 'secondary'

/** The roles set by hand, per screen, as typed. */
export type RoleTexts = { readonly [M in RoleMode]: Readonly<Partial<Record<RoleName, string>>> }

/** Everything the form holds. */
export interface LookState {
  /**
   * The three colours as typed. `tertiary` is "Your brand colour"; empty = none chosen yet (the
   * neutral default look, which saves no colours at all). `primary` is the page, `secondary` the
   * panels.
   */
  readonly colours: Readonly<Record<ColourKey, string>>
  /** True for the page / the panels once the person has set it: the brand colour stops filling it. */
  readonly edited: Readonly<Record<FilledKey, boolean>>
  readonly overrides: RoleTexts
  readonly font: ThemeFontId
  readonly radius: number
  readonly shadow: number
  readonly scheme: ThemeScheme
  readonly logoAssetId: string | null
}

const NO_OVERRIDES: RoleTexts = { light: {}, dark: {} }

// --- Brand-first tints ---------------------------------------------------------------------------

/**
 * The page and the panels a brand colour fills in (D93): the light screen's page and panels of the
 * brand's palette, `semanticColours(generatePalette(brand))` — a calm tint of the brand's hue for
 * the page, white for the panels. With no (or no usable) brand colour: the neutral default
 * palette's, the page a venue without a look has.
 */
export function tintsOf(brand: string | null): { readonly page: string; readonly panels: string } {
  const colours = semanticColours(brand === null ? DEFAULT_PALETTE : generatePalette(brand))
  return { page: colours.background.toLowerCase(), panels: colours.surface.toLowerCase() }
}

/**
 * How much colour (OKLCH chroma) a page may carry before the tab warns that it is strongly
 * saturated. The engine's own monochrome suggestion (`suggestHarmony`) never gives the page more
 * than 0.02 (and the panels never more than 0.035); a page with two and a half times that is no
 * longer a tint, and text and photos sit uneasily on it. It is also above the most colour the
 * brand-first pre-fill ever gives a page (0.044, for a pure green or magenta), so the pre-fill
 * itself never warns.
 */
export const STRONG_PAGE_CHROMA = 0.05

/** How much colour a `#rrggbb` carries: its OKLCH chroma (0 is a grey). */
export function chromaOf(hex: string): number {
  return hexToOklch(hex).c
}

/** True when the page colour (as typed) is strongly saturated; false for text that is no colour. */
export function isStronglySaturated(page: string): boolean {
  const hex = normaliseHex(page)
  return hex !== null && chromaOf(hex) > STRONG_PAGE_CHROMA
}

/**
 * The screens on which the highlight stands out less than 3:1 against the page (WCAG 1.4.11, D93
 * point 2). It stays as the person chose it; the buttons get the strong outline instead.
 */
export function paleHighlightScreens(roles: ThemeRoleSet): RoleMode[] {
  return ROLE_MODES.filter(
    (mode) => contrastRatio(roles[mode].accent, roles[mode].background) < MIN_CONTROL_CONTRAST,
  )
}

// --- From a saved look to the form ---------------------------------------------------------------

/** The form state of a saved look (null = the venue has none: the default look). */
export function lookStateOf(theme: VenueTheme | null): LookState {
  const saved = theme?.colors
  const brand = saved?.tertiary ?? theme?.brand ?? ''
  const tints = tintsOf(normaliseHex(brand))
  return {
    colours: saved ?? { primary: tints.page, secondary: tints.panels, tertiary: brand },
    // A saved page or panels that is not the brand's tint was set by the person (or by a preset).
    edited: {
      primary: saved !== undefined && saved.primary !== tints.page,
      secondary: saved !== undefined && saved.secondary !== tints.panels,
    },
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

/**
 * True when a saved look is the old way, one brand colour: guests get colours from the palette
 * path, which the form's three colours replace. Saving it from the form changes them a little, so
 * the tab offers it as an unsaved change rather than showing a preview that guests do not have.
 */
export function isBrandOnlyLook(theme: VenueTheme | null): boolean {
  return theme !== null && theme.colors === undefined && theme.brand !== undefined
}

// --- From the form to a look ---------------------------------------------------------------------

/** A field that is not a colour yet: one of the three colours, or `<screen>.<role>`. */
export type InvalidField = ColourKey | `${RoleMode}.${RoleName}`

/** What the form works out to. */
export interface LookView {
  /** The whole look to save, or null while some field is not a colour. */
  readonly theme: VenueTheme | null
  readonly invalid: readonly InvalidField[]
  /** The roles of both screens as guests will get them (overrides included). */
  readonly roles: ThemeRoleSet | null
  /** The same without any override: what "Reset" goes back to. */
  readonly derived: ThemeRoleSet | null
  /** The text-on-colour and control pairs that do not read. */
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

/**
 * True when the look has colours of its own: a brand colour is chosen, or the page or the panels
 * were set. Otherwise it is the neutral default look and saves no colours (so a venue that only
 * changes its font keeps the palette it has always published).
 */
function hasColours(state: LookState): boolean {
  return state.colours.tertiary.trim() !== '' || state.edited.primary || state.edited.secondary
}

/** The whole look of a form state: every v2 field, so a save can never be partial. */
export function lookViewOf(state: LookState): LookView {
  const invalid: InvalidField[] = []
  const brandText = state.colours.tertiary.trim()
  const brand = normaliseHex(brandText)
  if (brandText !== '' && brand === null) invalid.push('tertiary')

  let colours: ThemeColours | undefined
  if (hasColours(state)) {
    const page = normaliseHex(state.colours.primary)
    const panels = normaliseHex(state.colours.secondary)
    if (page === null) invalid.push('primary')
    if (panels === null) invalid.push('secondary')
    if (page !== null && panels !== null && invalid.length === 0) {
      colours = { primary: page, secondary: panels, tertiary: brand ?? FALLBACK_BRAND }
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
    // Never a brand colour and never a preset: the three colours, saying it started from none.
    ...(colours === undefined ? {} : { preset: null, colors: colours }),
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

// --- Changing the colours ------------------------------------------------------------------------

/**
 * Takes the light screen's hand-set role off, so a colour just chosen with a picker is not held
 * back by an earlier pin (a look that began as one of the designer's presets pinned all of them).
 */
function releaseLight(overrides: RoleTexts, role: RoleName): RoleTexts {
  if (overrides.light[role] === undefined) return overrides
  const { [role]: _released, ...rest } = overrides.light
  return { ...overrides, light: rest }
}

/** Sets "Your brand colour" as typed; the page and the panels the person has not set follow it. */
export function setBrand(state: LookState, text: string): LookState {
  const hex = normaliseHex(text)
  const colours: Record<ColourKey, string> = { ...state.colours, tertiary: text }
  // Half a colour changes nothing else; an empty box takes the neutral tints back.
  if (hex !== null || text.trim() === '') {
    const tints = tintsOf(hex)
    if (!state.edited.primary) colours.primary = tints.page
    if (!state.edited.secondary) colours.secondary = tints.panels
  }
  return { ...state, colours, overrides: releaseLight(state.overrides, 'accent') }
}

/** Sets one of the three colours as typed. The page and the panels are the person's from then on. */
export function setColour(state: LookState, key: ColourKey, text: string): LookState {
  if (key === 'tertiary') return setBrand(state, text)
  const role = key === 'primary' ? 'background' : 'surface'
  return {
    ...state,
    colours: { ...state.colours, [key]: text },
    edited: { ...state.edited, [key]: true },
    overrides: releaseLight(state.overrides, role),
  }
}

/** Hands the page and the panels back to the brand colour: both are its tints again. */
export function followBrand(state: LookState): LookState {
  const text = state.colours.tertiary
  const hex = normaliseHex(text)
  if (hex === null && text.trim() !== '') return state
  const tints = tintsOf(hex)
  return {
    ...state,
    colours: { ...state.colours, primary: tints.page, secondary: tints.panels },
    edited: { primary: false, secondary: false },
    overrides: releaseLight(releaseLight(state.overrides, 'background'), 'surface'),
  }
}

/** True when the page or the panels is the person's own, so "follow the brand colour" has work to do. */
export function hasOwnTints(state: LookState): boolean {
  return state.edited.primary || state.edited.secondary
}

/** The colour the "suggest with colour theory" menu starts from: the brand colour, else the neutral grey. */
export function harmonySeed(state: LookState): string {
  return normaliseHex(state.colours.tertiary) ?? FALLBACK_BRAND
}

/**
 * Fills the page and the panels by a harmony rule, seeded from the brand colour, which stays as it
 * is. They are the rule's choice from then on, not the brand's tints.
 */
export function applyHarmony(state: LookState, rule: HarmonyRule): LookState {
  const colours = suggestHarmony(harmonySeed(state), rule)
  return {
    ...state,
    colours,
    edited: { primary: true, secondary: true },
    overrides: releaseLight(releaseLight(state.overrides, 'background'), 'surface'),
  }
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

/** True when the role of that screen is set by hand. */
export function isOverridden(state: LookState, mode: RoleMode, role: RoleName): boolean {
  return state.overrides[mode][role] !== undefined
}

/** Takes every hand-set colour off: the whole look is derived again. */
export function clearAllOverrides(state: LookState): LookState {
  return { ...state, overrides: NO_OVERRIDES }
}

// --- Pairs ---------------------------------------------------------------------------------------

/** One pair a role takes part in. */
export interface RolePair {
  readonly fg: AnyRoleName
  readonly bg: AnyRoleName
  readonly min: number
  /** The other role of the pair, as seen from the role asked about. */
  readonly other: AnyRoleName
}

function pairsIn(
  pairs: readonly { readonly fg: AnyRoleName; readonly bg: AnyRoleName; readonly min: number }[],
  role: AnyRoleName,
): RolePair[] {
  return pairs
    .filter((pair) => pair.fg === role || pair.bg === role)
    .map((pair) => ({
      fg: pair.fg,
      bg: pair.bg,
      min: pair.min,
      other: pair.fg === role ? pair.bg : pair.fg,
    }))
}

/** The required text pairs a base role is part of (as the text or as what the text sits on). */
export function pairsOfRole(role: RoleName): RolePair[] {
  return pairsIn(REQUIRED_PAIRS, role)
}

/** The pairs of one of the roles D93 added (status text, the selected fill, the focus ring…). */
export function pairsOfExtendedRole(role: ExtendedRoleName): RolePair[] {
  return pairsIn(EXTENDED_PAIRS, role)
}

/** A ratio as shown: rounded DOWN to one decimal, so 4.47 never reads as the passing 4.5. */
export function shownRatio(ratio: number): number {
  return Math.floor(ratio * 10) / 10
}
