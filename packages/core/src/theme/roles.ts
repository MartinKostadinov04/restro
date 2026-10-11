// The eight colour roles a face paints with (D70, brief SH-01; the designer's handover §10), for a
// light and a dark screen, and the text-on-colour pairs that must read. Role names are snake_case
// here and in every stored or published JSON; the shell maps them to its camelCase
// `SemanticColours` once (SH-03).
//
// No imports from the snapshot or the settings: the snapshot schema imports this file.

import { z } from 'zod'

import { contrastRatio, MIN_TEXT_CONTRAST } from './contrast'

/** The eight roles, in the order the designer lists them. */
export const ROLE_NAMES = [
  'background',
  'surface',
  'accent',
  'on_accent',
  'text',
  'muted',
  'accent_text',
  'border',
] as const

/** One colour role. */
export type RoleName = (typeof ROLE_NAMES)[number]

/** One scheme's colours, each `#rrggbb` in lower case. */
export type ThemeRoles = { readonly [R in RoleName]: string }

/** The roles for a light and for a dark screen. */
export interface ThemeRoleSet {
  readonly light: ThemeRoles
  readonly dark: ThemeRoles
}

/** The three colours a venue chooses (D70): page ~60%, panels ~30%, highlights ~10%. */
export interface ThemeColours {
  readonly primary: string
  readonly secondary: string
  readonly tertiary: string
}

/** Roles the venue set by hand, per scheme; every other role is derived. */
export interface RoleOverrides {
  readonly light?: Partial<ThemeRoles>
  readonly dark?: Partial<ThemeRoles>
}

/** The two schemes a role set has. */
export const ROLE_MODES = ['light', 'dark'] as const

/** One scheme of a role set. */
export type RoleMode = (typeof ROLE_MODES)[number]

/**
 * How the guest page picks a scheme (D70): follow the phone (`auto`), or always `light` or `dark`.
 * The policy only chooses between the two role sets; it never generates one.
 */
export const THEME_SCHEMES = ['auto', 'light', 'dark'] as const

/** A venue's light/dark policy. */
export type ThemeScheme = (typeof THEME_SCHEMES)[number]

/** Text-on-colour pairs that must read at `min` (WCAG AA 4.5:1). */
export const REQUIRED_PAIRS: readonly {
  readonly fg: RoleName
  readonly bg: RoleName
  readonly min: number
}[] = Object.freeze([
  { fg: 'text', bg: 'background', min: MIN_TEXT_CONTRAST },
  { fg: 'text', bg: 'surface', min: MIN_TEXT_CONTRAST },
  { fg: 'muted', bg: 'background', min: MIN_TEXT_CONTRAST },
  { fg: 'muted', bg: 'surface', min: MIN_TEXT_CONTRAST },
  { fg: 'accent_text', bg: 'background', min: MIN_TEXT_CONTRAST },
  { fg: 'accent_text', bg: 'surface', min: MIN_TEXT_CONTRAST },
  { fg: 'on_accent', bg: 'accent', min: MIN_TEXT_CONTRAST },
])

/** One pair that does not read. `ratio` is the WCAG contrast, rounded down to two decimals. */
export interface PairIssue {
  readonly mode: RoleMode
  readonly fg: RoleName
  readonly bg: RoleName
  readonly ratio: number
  readonly min: number
}

/**
 * Every pair of `REQUIRED_PAIRS` that does not read, light first, in the list's order. An empty
 * list means the set is readable. The comparison uses the exact ratio; only the reported `ratio`
 * is rounded (down, so a reported 4.49 never hides a pass).
 */
export function validateRoles(set: ThemeRoleSet): PairIssue[] {
  const issues: PairIssue[] = []
  for (const mode of ROLE_MODES) {
    const roles = set[mode]
    for (const { fg, bg, min } of REQUIRED_PAIRS) {
      const ratio = contrastRatio(roles[fg], roles[bg])
      if (ratio < min) issues.push({ mode, fg, bg, ratio: Math.floor(ratio * 100) / 100, min })
    }
  }
  return issues
}

/** `#rrggbb` in lower case: how a role is stored and published. */
export const RoleColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb in lower case')

/** One scheme's eight roles: strict, every role a lower-case `#rrggbb`. */
export const ThemeRolesSchema = z.strictObject({
  background: RoleColourSchema,
  surface: RoleColourSchema,
  accent: RoleColourSchema,
  on_accent: RoleColourSchema,
  text: RoleColourSchema,
  muted: RoleColourSchema,
  accent_text: RoleColourSchema,
  border: RoleColourSchema,
})

/** Both schemes' roles. */
export const ThemeRoleSetSchema = z.strictObject({
  light: ThemeRolesSchema,
  dark: ThemeRolesSchema,
})
