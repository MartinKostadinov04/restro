// From a venue's colours to the eight roles a face paints with (R13; D70; brief SH-01).
//
// Two paths:
// - v1 (S3-02/S3-03, unchanged): one brand colour → an 11-step HSL palette (`generatePalette`) →
//   `semanticColours` / `semanticColoursDark`, each pair nudged along the palette until it reads.
//   Moved here from the shell (`palette.ts`), which re-exports it.
// - v2 (SH-01): three colours, primary (~60%, the page), secondary (~30%, panels) and tertiary
//   (~10%, highlights) → `deriveRoles`, worked out in OKLCH so every move keeps the hue.
//
// Ported from the Platform's `resources/js/Pages/Design/Index.jsx` lines 26-46 (`generatePalette`:
// steps 50..950 at HSL lightness .95, .9, .8 … .1, .05 with `chroma(base).set('hsl.l', l).hex()`)
// and 120-130 (the palette stored as a list, the brand colour being the 500 step).
// Changed while porting: no chroma-js; invalid colours fall back to a neutral grey; semantic roles
// instead of palette slots picked by magic index; every text-on-colour pair checked for contrast.

import {
  hexToHsl,
  hexToOklch,
  hslToHex,
  isHexColour,
  mixOklab,
  type Oklch,
  oklchToHex,
} from './colour'
import { contrastRatio, MIN_TEXT_CONTRAST, readableOn, readsOnAll } from './contrast'
import {
  ROLE_NAMES,
  type RoleMode,
  type RoleOverrides,
  type ThemeColours,
  type ThemeRoleSet,
  type ThemeRoles,
} from './roles'

// --- v1: the brand palette ----------------------------------------------------------------------

/** The palette steps, light to dark, as the Platform names them. */
export const PALETTE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** One palette step. */
export type PaletteStep = (typeof PALETTE_STEPS)[number]

/** An 11-step palette: step name to `#rrggbb`. */
export type Palette = { readonly [S in PaletteStep]: string }

/** HSL lightness of each step (Platform `generatePalette`). */
const STEP_LIGHTNESS: { readonly [S in PaletteStep]: number } = {
  50: 0.95,
  100: 0.9,
  200: 0.8,
  300: 0.7,
  400: 0.6,
  500: 0.5,
  600: 0.4,
  700: 0.3,
  800: 0.2,
  900: 0.1,
  950: 0.05,
}

/** The grey the Platform falls back to when there is no brand colour yet. */
export const FALLBACK_BRAND = '#6b7280'

/** The 11-step palette of one brand colour: its hue and saturation at each step's lightness. */
export function generatePalette(brand: string): Palette {
  const { h, s } = hexToHsl(isHexColour(brand) ? brand : FALLBACK_BRAND)
  const entries = PALETTE_STEPS.map((step) => [step, hslToHex(h, s, STEP_LIGHTNESS[step])] as const)
  return Object.fromEntries(entries) as unknown as Palette
}

/**
 * The palette a venue gets until it chooses a colour: a neutral zinc grey (S3-01a). It is not
 * `generatePalette(FALLBACK_BRAND)`; `DEFAULT_THEME` in the snapshot builder publishes these exact
 * steps, and every venue without a theme has been published with them.
 */
export const DEFAULT_PALETTE: Palette = Object.freeze({
  50: '#f8f8f9',
  100: '#efeff1',
  200: '#dcdce0',
  300: '#bdbdc4',
  400: '#9a9aa3',
  500: '#7c7c86',
  600: '#63636c',
  700: '#505058',
  800: '#3f3f46',
  900: '#27272a',
  950: '#18181b',
})

const WHITE = '#ffffff'
const BLACK = '#000000'

/** The colours a face paints with. Every `on*` / text colour reads on the colours it sits on. */
export interface SemanticColours {
  /** The page. */
  readonly background: string
  /** Cards and sheets on the page. */
  readonly surface: string
  /** The brand colour, for fills (buttons, chips, markers). */
  readonly accent: string
  /** Text and icons on `accent`. */
  readonly onAccent: string
  /** Body text; reads on `background` and `surface`. */
  readonly text: string
  /** Secondary text; reads on `background` and `surface`. */
  readonly muted: string
  /** The brand colour as text or an outline; reads on `background` and `surface`. */
  readonly accentText: string
  /** Dividers and card outlines. */
  readonly border: string
}

/** The semantic colours of a palette, each pair checked for contrast (R13). */
export function semanticColours(palette: Palette): SemanticColours {
  const background = palette[50]
  const surface = WHITE
  const both = [background, surface]
  const accent = palette[500]
  return {
    background,
    surface,
    accent,
    onAccent: readableOn([accent], [WHITE, palette[50], palette[950], BLACK]),
    text: readableOn(both, [palette[950], palette[900], BLACK]),
    muted: readableOn(both, [palette[700], palette[800], palette[900], palette[950], BLACK]),
    accentText: readableOn(both, [
      palette[500],
      palette[600],
      palette[700],
      palette[800],
      palette[900],
      palette[950],
      BLACK,
    ]),
    border: palette[200],
  }
}

/**
 * The same colours for a dark screen (S3-03: the phone page follows the guest's colour scheme).
 * Built from the dark end of the palette and checked pair by pair like `semanticColours`: the
 * page is the 950 step, cards the 900 step, and text and the brand-as-text colour come from the
 * light end and are nudged along the palette (then to white) until they read.
 */
export function semanticColoursDark(palette: Palette): SemanticColours {
  const background = palette[950]
  const surface = palette[900]
  const both = [background, surface]
  const accent = palette[500]
  return {
    background,
    surface,
    accent,
    onAccent: readableOn([accent], [WHITE, palette[50], palette[950], BLACK]),
    text: readableOn(both, [palette[50], palette[100], WHITE]),
    muted: readableOn(both, [palette[300], palette[200], palette[100], palette[50], WHITE]),
    accentText: readableOn(both, [
      palette[400],
      palette[300],
      palette[200],
      palette[100],
      palette[50],
      WHITE,
    ]),
    border: palette[800],
  }
}

/** The shell's camelCase colours as snake_case roles (lower-cased). */
export function rolesFromSemantic(colours: SemanticColours): ThemeRoles {
  return {
    background: colours.background.toLowerCase(),
    surface: colours.surface.toLowerCase(),
    accent: colours.accent.toLowerCase(),
    on_accent: colours.onAccent.toLowerCase(),
    text: colours.text.toLowerCase(),
    muted: colours.muted.toLowerCase(),
    accent_text: colours.accentText.toLowerCase(),
    border: colours.border.toLowerCase(),
  }
}

/** The v1 roles of a palette: `semanticColours` (light) and `semanticColoursDark` (dark). */
export function paletteRoles(palette: Palette): ThemeRoleSet {
  return {
    light: rolesFromSemantic(semanticColours(palette)),
    dark: rolesFromSemantic(semanticColoursDark(palette)),
  }
}

/** A role set with the overrides laid over it, each kept exactly as given. */
export function withOverrides(set: ThemeRoleSet, overrides?: RoleOverrides): ThemeRoleSet {
  if (overrides === undefined) return set
  const lay = (mode: RoleMode): ThemeRoles => {
    const own = overrides[mode]
    if (own === undefined) return set[mode]
    const roles = { ...set[mode] }
    for (const role of ROLE_NAMES) {
      const value = own[role]
      if (value !== undefined) roles[role] = value
    }
    return roles
  }
  return { light: lay('light'), dark: lay('dark') }
}

// --- v2: three colours → eight roles, in OKLCH ---------------------------------------------------

/** OKLCH lightness the light scheme's ink starts at, then lowered until it reads (a deep ink). */
const LIGHT_INK_L = 0.28
/** OKLCH lightness the dark scheme's ink starts at, then raised until it reads (a light ink). */
const DARK_INK_L = 0.94
/** Ink stays low in chroma: a tint of the page's hue, never a colour of its own. */
const LIGHT_INK_MAX_CHROMA = 0.045
const DARK_INK_MAX_CHROMA = 0.025
/** The dark page: the primary's hue at L 0.18 (inside the 0.16–0.20 band), chroma reduced. */
const DARK_BACKGROUND_L = 0.18
const DARK_BACKGROUND_MAX_CHROMA = 0.03
/** The dark panels: the secondary's hue one step lighter than the dark page. */
const DARK_SURFACE_L = 0.24
const DARK_SURFACE_MAX_CHROMA = 0.035
/** How much of the chroma the dark page and panels keep. */
const DARK_CHROMA_SHARE = 0.5
/** The contrast an accent fill needs against the page to stand out (WCAG non-text, 3:1). */
const ACCENT_STANDS_OUT = 3
/** How much of the ink the border takes (a quiet line: 12–18%). */
const BORDER_SHARE = 0.15
/** Step of every lightness search in OKLCH. */
const L_STEP = 0.005

/** The 256 neutral greys, dark to light. */
const GREYS: readonly string[] = Array.from({ length: 256 }, (_, value) => {
  const channel = value.toString(16).padStart(2, '0')
  return `#${channel}${channel}${channel}`
})

/**
 * A grey that reads on every background when neither black nor white does (only when the
 * backgrounds are a near-black and a near-white: the ink must then sit between them), or null.
 */
function inkBetween(backgrounds: readonly string[]): string | null {
  for (const grey of GREYS) if (readsOnAll(grey, backgrounds)) return grey
  return null
}

/** Which way a readable colour lies from these backgrounds: darker, lighter, or neither. */
function inkSide(
  backgrounds: readonly string[],
  prefer: 'dark' | 'light',
): 'dark' | 'light' | null {
  const dark = readsOnAll(BLACK, backgrounds)
  const light = readsOnAll(WHITE, backgrounds)
  if (dark && light) return prefer
  if (dark) return 'dark'
  if (light) return 'light'
  return null
}

/** True when some colour reads on both colours (black, white or a grey between). */
function shareAnInk(a: string, b: string): boolean {
  return inkSide([a, b], 'dark') !== null || inkBetween([a, b]) !== null
}

/**
 * The first colour along OKLCH lightness, from `from.l` towards black (`dark`) or white (`light`)
 * at `from`'s hue and chroma, that reads on every background; the end point (black or white) when
 * none before it does.
 */
function alongLightness(
  from: Oklch,
  direction: 'dark' | 'light',
  backgrounds: readonly string[],
  min = MIN_TEXT_CONTRAST,
): string {
  const steps = Math.ceil((direction === 'dark' ? from.l : 1 - from.l) / L_STEP)
  for (let step = 0; step <= steps; step++) {
    const l = direction === 'dark' ? from.l - step * L_STEP : from.l + step * L_STEP
    const hex = oklchToHex({ l, c: from.c, h: from.h })
    if (readsOnAll(hex, backgrounds, min)) return hex
  }
  return direction === 'dark' ? BLACK : WHITE
}

/**
 * The ink of a scheme: at `hue` and a low `chroma`, starting from a deep (`dark`) or light
 * (`light`) lightness and moved further until it reads on every background. Falls back to black
 * or white, and to a grey between them when only that reads; never a failing colour when any
 * colour can read.
 */
function inkFor(
  backgrounds: readonly string[],
  hue: number,
  chroma: number,
  prefer: 'dark' | 'light',
): string {
  const side = inkSide(backgrounds, prefer)
  if (side === 'dark')
    return alongLightness({ l: LIGHT_INK_L, c: chroma, h: hue }, 'dark', backgrounds)
  if (side === 'light')
    return alongLightness({ l: DARK_INK_L, c: chroma, h: hue }, 'light', backgrounds)
  return inkBetween(backgrounds) ?? readableOn(backgrounds, [BLACK, WHITE])
}

/**
 * The panel colour moved in lightness (hue and chroma kept) until it shares an ink with the page:
 * a page and panels on opposite sides of mid-grey leave no colour that reads on both, and every
 * text role sits on both. Kept as chosen whenever an ink exists.
 */
function reconcileSurface(background: string, surface: string, prefer: 'dark' | 'light'): string {
  if (shareAnInk(background, surface)) return surface
  // The page decides the side: a page black reads on gets lighter panels, else darker ones.
  const side = inkSide([background], prefer)
  const ink = side === 'dark' ? BLACK : WHITE
  const from = hexToOklch(surface)
  return alongLightness(from, side === 'dark' ? 'light' : 'dark', [ink])
}

/**
 * The softest blend from `base` toward `background` (mixed in OKLab) that still reads on every
 * background: as quiet as secondary text can be while staying readable. `base` itself when no
 * blend does.
 */
function softestBlend(base: string, background: string, backgrounds: readonly string[]): string {
  for (let share = 100; share > 0; share--) {
    const hex = mixOklab(base, background, share / 100)
    if (readsOnAll(hex, backgrounds)) return hex
  }
  return base
}

/** The accent as text: its hue and chroma, lightness moved until it reads; else `fallback`. */
function accentAsText(
  accent: string,
  backgrounds: readonly string[],
  prefer: 'dark' | 'light',
  fallback: string,
): string {
  if (readsOnAll(accent, backgrounds)) return accent
  const side = inkSide(backgrounds, prefer)
  if (side === null) return fallback
  const moved = alongLightness(hexToOklch(accent), side, backgrounds)
  return readsOnAll(moved, backgrounds) ? moved : fallback
}

/** The tertiary, lightened (hue and chroma kept) until it stands out on the dark page. */
function accentOnDark(tertiary: string, background: string): string {
  if (contrastRatio(tertiary, background) >= ACCENT_STANDS_OUT) return tertiary
  return alongLightness(hexToOklch(tertiary), 'light', [background], ACCENT_STANDS_OUT)
}

/** The base roles of one scheme: page, panels and highlight, before the text roles. */
interface Base {
  readonly background: string
  readonly surface: string
  readonly accent: string
  /** The hue and chroma of the scheme's ink. */
  readonly ink: { readonly hue: number; readonly chroma: number }
  /** Which side ink prefers when both would read. */
  readonly prefer: 'dark' | 'light'
}

/** The text roles of a scheme from its base, each override kept verbatim. */
function completeScheme(base: Base, own: Partial<ThemeRoles>): ThemeRoles {
  const { background, accent, prefer } = base
  const surface = own.surface ?? reconcileSurface(background, base.surface, prefer)
  const both = [background, surface]
  const derivedInk = inkFor(both, base.ink.hue, base.ink.chroma, prefer)
  const text = own.text ?? derivedInk
  // Derived roles build on readable colours only: an override that does not read is reported by
  // `validateRoles`, never copied into the colours derived from it.
  const readableText = readsOnAll(text, both) ? text : derivedInk
  const muted = own.muted ?? softestBlend(readableText, background, both)
  const accentText = own.accent_text ?? accentAsText(accent, both, prefer, readableText)
  const onAccent =
    own.on_accent ?? readableOn([accent], [background, text, WHITE, BLACK], MIN_TEXT_CONTRAST)
  const border = own.border ?? mixOklab(background, text, BORDER_SHARE)
  return {
    background,
    surface,
    accent,
    on_accent: onAccent,
    text,
    muted,
    accent_text: accentText,
    border,
  }
}

/**
 * The eight roles of three colours, for a light and a dark screen (D70, brief SH-01 §4).
 *
 * Light, the colours as chosen: the page is the primary, the panels the secondary, the highlight
 * the tertiary. The ink is a deep, low-chroma colour in the primary's hue, darkened until it reads
 * on the page and the panels; muted text is the softest blend of the ink toward the page that still
 * reads; the accent as text keeps the tertiary's hue and chroma and moves in lightness until it
 * reads; text on the accent is the first of page, ink, white and black that reads on it; the border
 * is 15% of the ink in the page.
 *
 * Dark, a hue-preserving transform (not an inversion): the page is the primary's hue at L 0.18
 * with reduced chroma, the panels the secondary's hue a step lighter, the highlight the tertiary
 * lightened until it stands out (3:1) on the dark page; the ink a light colour in the primary's
 * hue; the other roles as in light.
 *
 * Every derived role reads (`REQUIRED_PAIRS`) whatever the three colours are: where colour theory
 * cannot reach 4.5:1 the ink falls back to black or white (or the grey between them). The one
 * departure from "as chosen": panels on the other side of mid-grey from the page leave no colour
 * that reads on both, so then the panels move in lightness (hue and chroma kept) until one does.
 *
 * Overrides are kept verbatim and the other roles are derived around them; an override that does
 * not read is left for `validateRoles` to report. Pure and deterministic; throws only for a colour
 * that is not `#rrggbb`.
 */
export function deriveRoles(colours: ThemeColours, overrides?: RoleOverrides): ThemeRoleSet {
  const primary = colours.primary.toLowerCase()
  const secondary = colours.secondary.toLowerCase()
  const tertiary = colours.tertiary.toLowerCase()
  const p = hexToOklch(primary)
  const s = hexToOklch(secondary)
  const light = overrides?.light ?? {}
  const dark = overrides?.dark ?? {}

  const lightBackground = light.background ?? primary
  const lightScheme = completeScheme(
    {
      background: lightBackground,
      surface: secondary,
      accent: light.accent ?? tertiary,
      ink: { hue: p.h, chroma: Math.min(p.c, LIGHT_INK_MAX_CHROMA) },
      prefer: 'dark',
    },
    light,
  )

  const darkBackground =
    dark.background ??
    oklchToHex({
      l: DARK_BACKGROUND_L,
      c: Math.min(p.c * DARK_CHROMA_SHARE, DARK_BACKGROUND_MAX_CHROMA),
      h: p.h,
    })
  const darkSurface = oklchToHex({
    l: DARK_SURFACE_L,
    c: Math.min(s.c * DARK_CHROMA_SHARE, DARK_SURFACE_MAX_CHROMA),
    h: s.h,
  })
  const darkScheme = completeScheme(
    {
      background: darkBackground,
      surface: darkSurface,
      accent: dark.accent ?? accentOnDark(tertiary, darkBackground),
      ink: { hue: p.h, chroma: Math.min(p.c, DARK_INK_MAX_CHROMA) },
      prefer: 'light',
    },
    dark,
  )

  // Every override verbatim, whatever the derivation did around it.
  return withOverrides({ light: lightScheme, dark: darkScheme }, overrides)
}
