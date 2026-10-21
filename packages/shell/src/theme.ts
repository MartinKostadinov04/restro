// R13 Theme, the published-roles half (D70, brief SH-03): the colours a face paints with, taken
// from the snapshot's `theme.roles` when the publisher wrote them, and checked again here.
//
// The publisher already refuses a theme whose text does not read, so a failure below means a
// snapshot that did not come from our publisher or an old bug. The shell does not trust it
// anyway (defence in depth): R13's promise, every text-on-colour pair at 4.5:1 or better, must
// hold for whatever a face is handed.
//
//   1. The roles are checked with core's `validateRoles` (the same pairs the publisher checks).
//   2. A foreground role that fails is replaced by the nearest colour that reads on every
//      background it sits on: the palette steps, nearest in lightness to the venue's colour
//      first, then black and white. The venue's backgrounds and accent are never touched.
//   3. If a scheme still does not read (a page and a panel so far apart that no single text
//      colour reads on both), that scheme falls back to the colours derived from the palette,
//      which are built to read.

import {
  MIN_TEXT_CONTRAST,
  REQUIRED_PAIRS,
  type RoleMode,
  type RoleName,
  semanticFromRoles,
  type ThemeRoleSet,
  type ThemeRoles,
  validateRoles,
} from '@restro/core'

import {
  PALETTE_STEPS,
  type Palette,
  readableOn,
  relativeLuminance,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
} from './palette'

const BLACK = '#000000'
const WHITE = '#ffffff'

/** The roles as the camelCase colours a face reads (`on_accent` is `onAccent`), the extended ones too. */
const toColours = (roles: ThemeRoles): SemanticColours => semanticFromRoles(roles)

/** The base pairs a foreground role takes part in, in the required list's order. */
function pairsOf(fg: RoleName) {
  return REQUIRED_PAIRS.filter((pair) => pair.fg === fg)
}

/** True for one of the eight base roles (the shell repairs those; the extended ones pass through). */
const BASE_ROLES = new Set<string>(REQUIRED_PAIRS.flatMap((pair) => [pair.fg, pair.bg]))

/**
 * The palette steps nearest in lightness to `colour` first (ties keep the palette's own order),
 * so the replacement stays as close to the venue's choice as readability allows.
 */
function nearestSteps(colour: string, palette: Palette): string[] {
  const target = relativeLuminance(colour)
  return PALETTE_STEPS.map((step, order) => ({
    colour: palette[step],
    order,
    distance: Math.abs(relativeLuminance(palette[step]) - target),
  }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .map((entry) => entry.colour)
}

/** One scheme's roles with every failing foreground role replaced (step 2). */
function repaired(set: ThemeRoleSet, mode: RoleMode, palette: Palette): ThemeRoles {
  const roles = set[mode]
  const failing = new Set(
    validateRoles(set)
      .filter((issue) => issue.mode === mode && BASE_ROLES.has(issue.fg))
      .map((issue) => issue.fg as RoleName),
  )
  const out: { -readonly [R in RoleName]: string } & {
    [R in Exclude<keyof ThemeRoles, RoleName>]?: string
  } = { ...roles }
  for (const fg of failing) {
    const pairs = pairsOf(fg)
    out[fg] = readableOn(
      pairs.map((pair) => roles[pair.bg]),
      [roles[fg], ...nearestSteps(roles[fg], palette), BLACK, WHITE],
      Math.max(MIN_TEXT_CONTRAST, ...pairs.map((pair) => pair.min)),
    )
  }
  return out
}

/** Whether one scheme of a role set passes every base pair (an extended role that fails is dropped). */
function reads(set: ThemeRoleSet, mode: RoleMode): boolean {
  return validateRoles(set).every((issue) => issue.mode !== mode || !BASE_ROLES.has(issue.fg))
}

/** The scheme without any extended role that does not read: a face then falls back to its base roles. */
function withoutFailingExtended(set: ThemeRoleSet, mode: RoleMode): ThemeRoles {
  const failing = new Set(
    validateRoles(set)
      .filter((issue) => issue.mode === mode && !BASE_ROLES.has(issue.fg))
      .map((issue) => issue.fg),
  )
  if (failing.size === 0) return set[mode]
  const kept: Record<string, string> = {}
  for (const [role, value] of Object.entries(set[mode])) {
    if (value !== undefined && !failing.has(role as never)) kept[role] = value
  }
  return kept as unknown as ThemeRoles
}

/** The light and dark colours of a face's theme (R13). */
export interface ThemeColours {
  readonly colors: SemanticColours
  readonly colorsDark: SemanticColours
}

/**
 * The colours of the theme. With the snapshot's published roles: those roles, re-checked and
 * repaired as above. Without them (a snapshot from before D70): derived from the palette, exactly
 * as the shell always did.
 */
export function themeColours(published: ThemeRoleSet | undefined, palette: Palette): ThemeColours {
  if (published === undefined) {
    return { colors: semanticColours(palette), colorsDark: semanticColoursDark(palette) }
  }
  const fixed: ThemeRoleSet = {
    light: repaired(published, 'light', palette),
    dark: repaired(published, 'dark', palette),
  }
  return {
    colors: reads(fixed, 'light')
      ? toColours(withoutFailingExtended(fixed, 'light'))
      : semanticColours(palette),
    colorsDark: reads(fixed, 'dark')
      ? toColours(withoutFailingExtended(fixed, 'dark'))
      : semanticColoursDark(palette),
  }
}
