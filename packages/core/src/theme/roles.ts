// The colour roles a face paints with (D70, brief SH-01; the designer's handover §10), for a
// light and a dark screen, and the text-on-colour pairs that must read. The eight roles of D70
// are the base; D93 adds ten more for everything else that carries text or meaning (status,
// disabled text, the selected fill, the focus ring, the sheet backdrop, a strong control border),
// all optional in stored and published JSON so a snapshot from before still parses. Role names
// are snake_case here and in every stored or published JSON; the shell maps them to its
// camelCase `SemanticColours` once (SH-03).
//
// No imports from the snapshot or the settings: the snapshot schema imports this file.

import { z } from 'zod'

import { contrastRatio, MIN_CONTROL_CONTRAST, MIN_TEXT_CONTRAST } from './contrast'

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

/**
 * The roles D93 adds, in the order they are derived. Each `*_text` role is its colour as text,
 * made to read on the page and the panels; `selected` is a soft accent fill with `selected_text`
 * on it; `focus` and `border_strong` stand out 3:1 against the page and the panels; `backdrop`
 * is the colour behind a sheet (a face blends it with alpha).
 */
export const EXTENDED_ROLE_NAMES = [
  'error',
  'error_text',
  'success',
  'success_text',
  'disabled_text',
  'selected',
  'selected_text',
  'focus',
  'backdrop',
  'border_strong',
] as const

/** One of the roles D93 added. */
export type ExtendedRoleName = (typeof EXTENDED_ROLE_NAMES)[number]

/** Any role, base or extended. */
export type AnyRoleName = RoleName | ExtendedRoleName

/**
 * One scheme's colours, each `#rrggbb` in lower case: the eight base roles always, the extended
 * ones when the derivation (or the publisher) wrote them.
 */
export type ThemeRoles = { readonly [R in RoleName]: string } & {
  readonly [R in ExtendedRoleName]?: string
}

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

/** One pair a scheme is checked on. */
export interface RolePair {
  readonly fg: AnyRoleName
  readonly bg: AnyRoleName
  readonly min: number
}

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

/**
 * The pairs of the extended roles (D93), checked when a scheme has both roles of a pair: status
 * text and the selected fill's text read (4.5:1); disabled text, the strong border and the focus
 * ring stand out against the page and the panels (3:1, WCAG 1.4.11).
 */
export const EXTENDED_PAIRS: readonly RolePair[] = Object.freeze([
  { fg: 'error_text', bg: 'background', min: MIN_TEXT_CONTRAST },
  { fg: 'error_text', bg: 'surface', min: MIN_TEXT_CONTRAST },
  { fg: 'success_text', bg: 'background', min: MIN_TEXT_CONTRAST },
  { fg: 'success_text', bg: 'surface', min: MIN_TEXT_CONTRAST },
  { fg: 'selected_text', bg: 'selected', min: MIN_TEXT_CONTRAST },
  { fg: 'disabled_text', bg: 'background', min: MIN_CONTROL_CONTRAST },
  { fg: 'disabled_text', bg: 'surface', min: MIN_CONTROL_CONTRAST },
  { fg: 'border_strong', bg: 'background', min: MIN_CONTROL_CONTRAST },
  { fg: 'border_strong', bg: 'surface', min: MIN_CONTROL_CONTRAST },
  { fg: 'focus', bg: 'background', min: MIN_CONTROL_CONTRAST },
  { fg: 'focus', bg: 'surface', min: MIN_CONTROL_CONTRAST },
])

/** One pair that does not read. `ratio` is the WCAG contrast, rounded down to two decimals. */
export interface PairIssue {
  readonly mode: RoleMode
  readonly fg: AnyRoleName
  readonly bg: AnyRoleName
  readonly ratio: number
  readonly min: number
}

/**
 * Every pair of `REQUIRED_PAIRS` that does not read, then every pair of `EXTENDED_PAIRS` whose
 * two roles the scheme has, light first, in the lists' order. An empty list means the set is
 * readable. The comparison uses the exact ratio; only the reported `ratio` is rounded (down, so
 * a reported 4.49 never hides a pass).
 */
export function validateRoles(set: ThemeRoleSet): PairIssue[] {
  const issues: PairIssue[] = []
  for (const mode of ROLE_MODES) {
    const roles = set[mode]
    for (const { fg, bg, min } of [...REQUIRED_PAIRS, ...EXTENDED_PAIRS]) {
      const left = roles[fg]
      const right = roles[bg]
      if (left === undefined || right === undefined) continue
      const ratio = contrastRatio(left, right)
      if (ratio < min) issues.push({ mode, fg, bg, ratio: Math.floor(ratio * 100) / 100, min })
    }
  }
  return issues
}

/** `#rrggbb` in lower case: how a role is stored and published. */
export const RoleColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb in lower case')

/**
 * One scheme's roles: strict, every role a lower-case `#rrggbb`; the eight base roles required,
 * the extended ones optional (a snapshot from before D93 still parses).
 */
export const ThemeRolesSchema = z.strictObject({
  background: RoleColourSchema,
  surface: RoleColourSchema,
  accent: RoleColourSchema,
  on_accent: RoleColourSchema,
  text: RoleColourSchema,
  muted: RoleColourSchema,
  accent_text: RoleColourSchema,
  border: RoleColourSchema,
  error: RoleColourSchema.optional(),
  error_text: RoleColourSchema.optional(),
  success: RoleColourSchema.optional(),
  success_text: RoleColourSchema.optional(),
  disabled_text: RoleColourSchema.optional(),
  selected: RoleColourSchema.optional(),
  selected_text: RoleColourSchema.optional(),
  focus: RoleColourSchema.optional(),
  backdrop: RoleColourSchema.optional(),
  border_strong: RoleColourSchema.optional(),
})

/** Both schemes' roles. */
export const ThemeRoleSetSchema = z.strictObject({
  light: ThemeRolesSchema,
  dark: ThemeRolesSchema,
})
