// The eight roles and their readability check (brief SH-01 §3).
import { describe, expect, it } from 'vitest'

import { contrastRatio } from './contrast'
import {
  REQUIRED_PAIRS,
  ROLE_NAMES,
  type ThemeRoleSet,
  type ThemeRoles,
  ThemeRolesSchema,
  validateRoles,
} from './roles'

const READABLE: ThemeRoles = {
  background: '#ffffff',
  surface: '#f4f4f5',
  accent: '#1d4ed8',
  on_accent: '#ffffff',
  text: '#111111',
  muted: '#52525b',
  accent_text: '#1d4ed8',
  border: '#e4e4e7',
}

describe('roles', () => {
  it('names the eight roles in snake_case', () => {
    expect(ROLE_NAMES).toEqual([
      'background',
      'surface',
      'accent',
      'on_accent',
      'text',
      'muted',
      'accent_text',
      'border',
    ])
  })

  it('lists the seven text-on-colour pairs, all at WCAG AA 4.5:1', () => {
    expect(REQUIRED_PAIRS.map(({ fg, bg }) => `${fg}/${bg}`)).toEqual([
      'text/background',
      'text/surface',
      'muted/background',
      'muted/surface',
      'accent_text/background',
      'accent_text/surface',
      'on_accent/accent',
    ])
    expect(REQUIRED_PAIRS.every((pair) => pair.min === 4.5)).toBe(true)
  })

  it('finds nothing to report in a readable set', () => {
    expect(validateRoles({ light: READABLE, dark: READABLE })).toEqual([])
  })

  it('reports each failing pair with its scheme, its ratio rounded down, and nothing else', () => {
    const set: ThemeRoleSet = {
      light: { ...READABLE, muted: '#a1a1aa' },
      dark: { ...READABLE, on_accent: '#1e3a8a' },
    }
    const issues = validateRoles(set)
    expect(issues.map(({ mode, fg, bg }) => `${mode} ${fg}/${bg}`)).toEqual([
      'light muted/background',
      'light muted/surface',
      'dark on_accent/accent',
    ])
    for (const issue of issues) {
      const exact = contrastRatio(set[issue.mode][issue.fg], set[issue.mode][issue.bg])
      expect(issue.ratio).toBeLessThanOrEqual(exact)
      expect(exact - issue.ratio).toBeLessThan(0.01)
      expect(issue.min).toBe(4.5)
    }
  })

  it('draws the line at exactly 4.5:1', () => {
    // On white, #777777 reads at 4.48:1 and #767676 at 4.54:1 (the lightest grey that passes).
    const white = { ...READABLE, surface: '#ffffff' }
    const failing = validateRoles({ light: { ...white, muted: '#777777' }, dark: READABLE })
    expect(failing.map(({ fg, bg }) => `${fg}/${bg}`)).toEqual([
      'muted/background',
      'muted/surface',
    ])
    expect(failing[0]?.ratio).toBe(4.47)
    expect(validateRoles({ light: { ...white, muted: '#767676' }, dark: READABLE })).toEqual([])
  })

  it('stores roles strictly: eight lower-case #rrggbb, nothing else', () => {
    expect(ThemeRolesSchema.safeParse(READABLE).success).toBe(true)
    expect(ThemeRolesSchema.safeParse({ ...READABLE, text: '#ABCDEF' }).success).toBe(false)
    expect(ThemeRolesSchema.safeParse({ ...READABLE, extra: '#ffffff' }).success).toBe(false)
    const { border: _border, ...seven } = READABLE
    expect(ThemeRolesSchema.safeParse(seven).success).toBe(false)
  })
})
