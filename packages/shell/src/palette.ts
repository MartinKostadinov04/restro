// R13 Theme, the colour half: one brand colour to an 11-step palette, and from a palette to the
// semantic colours a face uses, each text-on-colour pair readable (WCAG 2.x contrast of at least
// 4.5:1, AA for normal text). Written in-house, no colour library (Martin, 10-10).
//
// Ported from the Platform's `resources/js/Pages/Design/Index.jsx` lines 26-46 (`generatePalette`:
// steps 50..950 at HSL lightness .95, .9, .8 … .1, .05 with `chroma(base).set('hsl.l', l).hex()`)
// and 120-130 (the palette stored as a list, the brand colour being the 500 step).
// Changed while porting: no chroma-js; semantic colours (background, surface, accent, on-accent,
// text, muted …) instead of palette slots picked by magic index; every pair checked for contrast
// and nudged along the palette (then to black or white) until it passes; invalid colours ignored.

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

/** WCAG AA contrast for normal text. */
export const MIN_TEXT_CONTRAST = 4.5

const WHITE = '#ffffff'
const BLACK = '#000000'

const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/

/** True for `#rrggbb` (either case). */
export function isHexColour(value: string): boolean {
  return HEX.test(value)
}

function parseHex(hex: string): [number, number, number] {
  const match = HEX.exec(hex)
  if (match === null) throw new RangeError(`not a #rrggbb colour: ${hex}`)
  return [
    Number.parseInt(match[1] ?? '00', 16),
    Number.parseInt(match[2] ?? '00', 16),
    Number.parseInt(match[3] ?? '00', 16),
  ]
}

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `#rrggbb` to hue (0–360), saturation (0–1) and lightness (0–1). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = parseHex(hex).map((value) => value / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** Hue (0–360), saturation (0–1) and lightness (0–1) to `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r1, g1, b1] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = l - chroma / 2
  return toHex(((r1 ?? 0) + m) * 255, ((g1 ?? 0) + m) * 255, ((b1 ?? 0) + m) * 255)
}

/** The 11-step palette of one brand colour: its hue and saturation at each step's lightness. */
export function generatePalette(brand: string): Palette {
  const { h, s } = hexToHsl(isHexColour(brand) ? brand : FALLBACK_BRAND)
  const entries = PALETTE_STEPS.map((step) => [step, hslToHex(h, s, STEP_LIGHTNESS[step])] as const)
  return Object.fromEntries(entries) as unknown as Palette
}

/** WCAG relative luminance of a `#rrggbb` colour (0 black … 1 white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The first candidate that reads on every background at `min` contrast; when none does, the one
 * that comes closest. Black and white at the end of a list make a pass certain for a single
 * background (one of them always reaches 4.58:1).
 */
export function readableOn(
  backgrounds: readonly string[],
  candidates: readonly string[],
  min = MIN_TEXT_CONTRAST,
): string {
  let best = candidates[0] ?? BLACK
  let bestScore = -1
  for (const candidate of candidates) {
    const score = Math.min(...backgrounds.map((background) => contrastRatio(candidate, background)))
    if (score >= min) return candidate
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

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

/** The palette steps of a theme, however many colours the snapshot carries. */
export function resolvePalette(colours: readonly string[]): Palette {
  const valid = colours.filter(isHexColour)
  if (valid.length === PALETTE_STEPS.length && colours.length === valid.length) {
    return Object.fromEntries(PALETTE_STEPS.map((step, index) => [step, valid[index]])) as Palette
  }
  // Another count is a list the publisher did not lay out by step: take the colour nearest the
  // middle lightness as the brand colour and lay the steps out ourselves.
  const brand = [...valid].sort(
    (a, b) => Math.abs(hexToHsl(a).l - 0.5) - Math.abs(hexToHsl(b).l - 0.5),
  )[0]
  return generatePalette(brand ?? FALLBACK_BRAND)
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

/** A readable text colour for any colour a venue picks (a section's colour hint). */
export function textOn(colour: string, palette: Palette): string {
  return readableOn([colour], [WHITE, palette[950], BLACK])
}
