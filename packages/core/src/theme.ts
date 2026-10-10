// The venue's look: one brand colour to an 11-step palette (R13), and the venue theme setting
// (`venues.settings.theme`, brief S3-03) that the publisher turns into the snapshot's theme.
//
// The colour maths moved here from the shell (S3-02) because the publisher, which lives in
// core/apply, derives the snapshot palette from the brand colour, and core cannot import the shell
// (the shell imports core). The shell re-exports all of it, so nothing that imports the shell
// changes. Written in-house, no colour library (Martin, 10-10).
//
// Ported from the Platform's `resources/js/Pages/Design/Index.jsx` lines 26-46 (`generatePalette`:
// steps 50..950 at HSL lightness .95, .9, .8 … .1, .05 with `chroma(base).set('hsl.l', l).hex()`)
// and 120-130 (the palette stored as a list, the brand colour being the 500 step).
// Changed while porting: no chroma-js; invalid colours fall back to a neutral grey; the venue
// stores only the brand colour and the logo (the palette is derived, never stored).

import { z } from 'zod'

import { AssetIdSchema } from './snapshot/schema'

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

const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/

/** True for `#rrggbb` (either case). */
export function isHexColour(value: string): boolean {
  return HEX.test(value)
}

/** `#rrggbb` to red, green and blue (0–255). Throws a `RangeError` for anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = HEX.exec(hex)
  if (match === null) throw new RangeError(`not a #rrggbb colour: ${hex}`)
  return [
    Number.parseInt(match[1] ?? '00', 16),
    Number.parseInt(match[2] ?? '00', 16),
    Number.parseInt(match[3] ?? '00', 16),
  ]
}

/** Red, green and blue (0–255, rounded and clamped) to `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** `#rrggbb` to hue (0–360), saturation (0–1) and lightness (0–1). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((value) => value / 255) as [number, number, number]
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
  return rgbToHex(((r1 ?? 0) + m) * 255, ((g1 ?? 0) + m) * 255, ((b1 ?? 0) + m) * 255)
}

/** The 11-step palette of one brand colour: its hue and saturation at each step's lightness. */
export function generatePalette(brand: string): Palette {
  const { h, s } = hexToHsl(isHexColour(brand) ? brand : FALLBACK_BRAND)
  const entries = PALETTE_STEPS.map((step) => [step, hslToHex(h, s, STEP_LIGHTNESS[step])] as const)
  return Object.fromEntries(entries) as unknown as Palette
}

// --- the venue theme setting ----------------------------------------------------------------

/**
 * `venues.settings.theme`: the brand colour (`#rrggbb`, lower case) and the logo (an asset id, or
 * null for none). The palette is always derived from the colour, never stored.
 */
export const VenueThemeSchema = z.strictObject({
  brand: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')
    .transform((value) => value.toLowerCase()),
  logo_asset_id: AssetIdSchema.nullable(),
})

/** The venue's theme setting. */
export type VenueTheme = z.output<typeof VenueThemeSchema>

/**
 * The theme a venue has set, or null when it has none (or the stored value is not valid, which
 * only a hand-edited row could cause: the venue then gets the default theme rather than an error).
 */
export function readVenueTheme(settings: unknown): VenueTheme | null {
  if (typeof settings !== 'object' || settings === null || !('theme' in settings)) return null
  const parsed = VenueThemeSchema.safeParse((settings as { theme: unknown }).theme)
  return parsed.success ? parsed.data : null
}

/** The 11 palette colours of a brand colour, light to dark, in the order a snapshot lists them. */
export function snapshotPalette(brand: string): string[] {
  const palette = generatePalette(brand)
  return PALETTE_STEPS.map((step) => palette[step])
}
