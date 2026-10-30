// The venue's look in theme terms (briefs S3-03 and SH-01 §8) and what the publisher makes of it:
// the snapshot's palette and its eight colour roles per scheme.
//
// It was stored as `venues.settings.theme` until the design record (D129, ../design/record.ts)
// replaced it (migration 0044): the record keeps the colours, the overrides and the logo, and
// `designThemeOf` gives this shape for the publisher and the admin's preview. Nothing is ever
// derived into storage: palette and roles are worked out at publish time, so a better derivation
// reaches every venue with its next publish.

import { z } from 'zod'

import { AssetIdSchema } from '../snapshot/schema'
import {
  DEFAULT_PALETTE,
  deriveRoles,
  generatePalette,
  PALETTE_STEPS,
  type Palette,
  paletteRoles,
  withOverrides,
} from './derive'
import { THEME_FONTS, type ThemeFontId } from './fonts'
import { THEME_PRESET_IDS } from './presets'
import { THEME_SCHEMES, type ThemeRoleSet } from './roles'

/** `#rrggbb` in either case, stored in lower case. */
export const HexInputSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')
  .transform((value) => value.toLowerCase())

/** Some of one scheme's roles, set by hand. */
const PartialRolesSchema = z.strictObject({
  background: HexInputSchema.optional(),
  surface: HexInputSchema.optional(),
  accent: HexInputSchema.optional(),
  on_accent: HexInputSchema.optional(),
  text: HexInputSchema.optional(),
  muted: HexInputSchema.optional(),
  accent_text: HexInputSchema.optional(),
  border: HexInputSchema.optional(),
})

/** The venue's three colours (D70): page ~60%, panels ~30%, highlights ~10%. */
export const ThemeColoursSchema = z.strictObject({
  primary: HexInputSchema,
  secondary: HexInputSchema,
  tertiary: HexInputSchema,
})

/** Roles set by hand, per scheme. */
export const RoleOverridesSchema = z.strictObject({
  light: PartialRolesSchema.optional(),
  dark: PartialRolesSchema.optional(),
})

/** The corner radius range, in px (the snapshot's `theme.radius`). */
export const THEME_RADIUS = { min: 0, max: 32 } as const
/** The shadow strength range (the snapshot's `theme.shadow`). */
export const THEME_SHADOW = { min: 0, max: 5 } as const

/**
 * A venue's look in theme terms (formerly `venues.settings.theme`). v1 fields: the brand colour (`#rrggbb`, lower-cased; optional since v2)
 * and the logo (an asset id, or null for none: the key is required, as in v1). v2 fields, each
 * optional: `preset` (the starting point it came from, or null for custom), `colors` (the three
 * venue colours), `overrides` (roles set by hand, per scheme), `font` (an id of `THEME_FONTS`),
 * `radius` (0–32 px), `shadow` (0–5) and `scheme` (`auto` follows the guest's phone).
 */
export const VenueThemeSchema = z.strictObject({
  brand: HexInputSchema.optional(),
  logo_asset_id: AssetIdSchema.nullable(),
  preset: z.enum(THEME_PRESET_IDS).nullable().optional(),
  colors: ThemeColoursSchema.optional(),
  overrides: RoleOverridesSchema.optional(),
  font: z.enum(THEME_FONTS.map((font) => font.id) as [ThemeFontId, ...ThemeFontId[]]).optional(),
  radius: z.int().min(THEME_RADIUS.min).max(THEME_RADIUS.max).optional(),
  shadow: z.int().min(THEME_SHADOW.min).max(THEME_SHADOW.max).optional(),
  scheme: z.enum(THEME_SCHEMES).optional(),
})

/** The venue's theme setting. */
export type VenueTheme = z.output<typeof VenueThemeSchema>

/** A palette as the list a snapshot carries, light to dark. */
export function paletteList(palette: Palette): string[] {
  return PALETTE_STEPS.map((step) => palette[step])
}

/** The 11 palette colours of a brand colour, light to dark, in the order a snapshot lists them. */
export function snapshotPalette(brand: string): string[] {
  return paletteList(generatePalette(brand))
}

/**
 * The palette a theme publishes: from the tertiary of its three colours (the highlight, the old
 * brand colour's job), else from its brand colour, else the default palette (`DEFAULT_PALETTE`,
 * what every venue without a theme has always published).
 */
export function themePaletteOf(theme: VenueTheme | null): Palette {
  if (theme?.colors !== undefined) return generatePalette(theme.colors.tertiary)
  if (theme?.brand !== undefined) return generatePalette(theme.brand)
  return DEFAULT_PALETTE
}

/**
 * The eight roles a theme publishes, light and dark. With the three colours set:
 * `deriveRoles(colors, overrides)`. Otherwise today's path: `semanticColours` and
 * `semanticColoursDark` of the theme's palette (`themePaletteOf`), so a v1 venue and a venue
 * without a theme get exactly the colours the shell derives from their palette today. Overrides
 * are laid over either path verbatim (D70: any derived colour may be overridden); whether the
 * result reads is `validateRoles`' to say.
 */
export function themeRolesOf(theme: VenueTheme | null): ThemeRoleSet {
  if (theme?.colors !== undefined) return deriveRoles(theme.colors, theme.overrides)
  return withOverrides(paletteRoles(themePaletteOf(theme)), theme?.overrides)
}
