// R13 with published roles (brief SH-03): the venue's roles are used, a pair that does not read is
// repaired, a snapshot without roles gets exactly the colours it always got, and the light/dark
// policy passes through.

import { type MenuSnapshot, REQUIRED_PAIRS, type ThemeRoles, validateRoles } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { CUSTOM_ROLES, fixture, snapshotFromSpec } from '../testing'
import { buildViewModel } from './build'
import {
  contrastRatio,
  MIN_TEXT_CONTRAST,
  relativeLuminance,
  resolvePalette,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
} from './palette'
import type { ViewModel } from './view-model'

const WEDNESDAY = '2026-10-07T20:30:00+03:00'

type Roles = NonNullable<MenuSnapshot['theme']['roles']>

const bgen = (bg: string, en: string) => ({ bg_BG: bg, en_US: en })

/** A one-item menu with the given theme fields. */
function themed(theme: Partial<MenuSnapshot['theme']>): MenuSnapshot {
  return snapshotFromSpec({
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    theme,
    sections: [{ title: bgen('Напитки', 'Drinks'), items: [{ name: bgen('Вода', 'Water') }] }],
  })
}

function viewOf(snapshot: MenuSnapshot): ViewModel {
  return buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
}

/** The shell's camelCase colours as the snake_case roles core checks. */
function asRoles(colours: SemanticColours): ThemeRoles {
  return {
    background: colours.background,
    surface: colours.surface,
    accent: colours.accent,
    on_accent: colours.onAccent,
    text: colours.text,
    muted: colours.muted,
    accent_text: colours.accentText,
    border: colours.border,
  }
}

/** What core's validator says about the theme a face receives. */
function issuesOf(view: ViewModel) {
  return validateRoles({ light: asRoles(view.theme.colors), dark: asRoles(view.theme.colorsDark) })
}

describe('R13 theme: a snapshot without roles gets the colours it always got', () => {
  it('gives exactly today’s colours for the fixture palette (pinned)', () => {
    const f = fixture('no-images')
    expect(f.snapshot.theme.roles).toBeUndefined()
    const { theme } = buildViewModel(f.snapshot, f.overlay, f.context)
    // These literals were taken from the shell before SH-03. They must never change for an old snapshot.
    expect(theme.colors).toEqual({
      background: '#fdf4f3',
      surface: '#ffffff',
      accent: '#d65b51',
      onAccent: '#000000',
      text: '#391411',
      muted: '#98372f',
      accentText: '#b9443a',
      border: '#f6d0cc',
    })
    expect(theme.colorsDark).toEqual({
      background: '#391411',
      surface: '#6a2e29',
      accent: '#d65b51',
      onAccent: '#000000',
      text: '#fdf4f3',
      muted: '#efaea7',
      accentText: '#efaea7',
      border: '#7e312b',
    })
  })

  it('is the derivation from the palette, for any palette', () => {
    for (const palette of [['#3366cc'], ['#e5827a', '#1d3557'], ['#ffe066']]) {
      const snapshot = themed({ palette })
      const view = viewOf(snapshot)
      const steps = resolvePalette(snapshot.theme.palette)
      expect(view.theme.colors).toEqual(semanticColours(steps))
      expect(view.theme.colorsDark).toEqual(semanticColoursDark(steps))
    }
  })

  it('has scheme auto', () => {
    expect(viewOf(themed({})).theme.scheme).toBe('auto')
  })
})

describe('R13 theme: the published roles are used', () => {
  it('guards the fixture: the custom roles read, and differ from the derived colours', () => {
    expect(validateRoles(CUSTOM_ROLES)).toEqual([])
    const f = fixture('custom-roles')
    const derived = semanticColours(resolvePalette(f.snapshot.theme.palette))
    expect(CUSTOM_ROLES.light.background).not.toBe(derived.background.toLowerCase())
    expect(CUSTOM_ROLES.dark.accent).not.toBe(derived.accent.toLowerCase())
  })

  it('maps snake_case roles to the camelCase colours, light and dark', () => {
    const f = fixture('custom-roles')
    const { theme } = buildViewModel(f.snapshot, f.overlay, f.context)
    const { light, dark } = CUSTOM_ROLES
    expect(theme.colors).toEqual({
      background: light.background,
      surface: light.surface,
      accent: light.accent,
      onAccent: light.on_accent,
      text: light.text,
      muted: light.muted,
      accentText: light.accent_text,
      border: light.border,
    })
    expect(theme.colorsDark).toEqual({
      background: dark.background,
      surface: dark.surface,
      accent: dark.accent,
      onAccent: dark.on_accent,
      text: dark.text,
      muted: dark.muted,
      accentText: dark.accent_text,
      border: dark.border,
    })
  })

  it('leaves the palette steps and the other tokens as the snapshot has them', () => {
    const f = fixture('custom-roles')
    const { theme } = buildViewModel(f.snapshot, f.overlay, f.context)
    expect(Object.keys(theme.palette)).toHaveLength(11)
    expect(theme).toMatchObject({ font: 'Inter', radius: 8, shadow: 1, logo: null })
  })
})

describe('R13 theme: a role that does not read is replaced', () => {
  const unreadable: Roles = {
    light: {
      ...CUSTOM_ROLES.light,
      // Cream on cream, a pale green on cream, white on a pale accent.
      text: '#f1ebdc',
      muted: '#e3dccb',
      accent_text: '#f0f4ee',
      accent: '#a8d5c8',
      on_accent: '#ffffff',
    },
    dark: { ...CUSTOM_ROLES.dark, text: '#1c2b26', on_accent: '#3a5a50' },
  }

  it('starts with a theme the validator rejects', () => {
    const pairs = validateRoles(unreadable).map((issue) => `${issue.mode}:${issue.fg}`)
    expect(pairs).toEqual(
      expect.arrayContaining([
        'light:text',
        'light:muted',
        'light:accent_text',
        'light:on_accent',
        'dark:text',
        'dark:on_accent',
      ]),
    )
  })

  it('repairs every failing foreground role so each pair reads', () => {
    const view = viewOf(themed({ roles: unreadable }))
    expect(issuesOf(view)).toEqual([])
    for (const roles of [asRoles(view.theme.colors), asRoles(view.theme.colorsDark)]) {
      for (const { fg, bg } of REQUIRED_PAIRS) {
        expect(contrastRatio(roles[fg], roles[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        )
      }
    }
  })

  it('touches nothing but the failing foreground roles', () => {
    const { theme } = viewOf(themed({ roles: unreadable }))
    for (const role of ['background', 'surface', 'accent', 'border'] as const) {
      expect(theme.colors[role]).toBe(unreadable.light[role])
      expect(theme.colorsDark[role]).toBe(unreadable.dark[role])
    }
    // The roles that already read are kept exactly as the venue chose them.
    expect(theme.colorsDark.muted).toBe(unreadable.dark.muted)
    expect(theme.colorsDark.accentText).toBe(unreadable.dark.accent_text)
    // Those that did not read are not what the venue gave.
    expect(theme.colors.text).not.toBe(unreadable.light.text)
    expect(theme.colorsDark.onAccent).not.toBe(unreadable.dark.on_accent)
  })

  it('picks the palette step nearest the venue’s colour in lightness, before black or white', () => {
    // Dark text on a dark page: the replacement is the darkest palette step that reads, not plain white.
    const { theme } = viewOf(themed({ roles: unreadable }))
    const { background, surface, text } = unreadable.dark
    const wanted = Object.values(theme.palette)
      .sort(
        (a, b) =>
          Math.abs(relativeLuminance(a) - relativeLuminance(text)) -
          Math.abs(relativeLuminance(b) - relativeLuminance(text)),
      )
      .find(
        (step) =>
          contrastRatio(step, background) >= MIN_TEXT_CONTRAST &&
          contrastRatio(step, surface) >= MIN_TEXT_CONTRAST,
      )
    expect(wanted).toBeDefined()
    expect(theme.colorsDark.text).toBe(wanted)
  })

  it('falls back to the derived colours for a scheme no single text colour can serve', () => {
    // A page and a panel so far apart that no one text colour reads on both.
    const impossible: Roles = {
      light: { ...CUSTOM_ROLES.light, background: '#000000', surface: '#ffffff' },
      dark: CUSTOM_ROLES.dark,
    }
    expect(validateRoles(impossible).length).toBeGreaterThan(0)
    const snapshot = themed({ roles: impossible })
    const view = viewOf(snapshot)
    const steps = resolvePalette(snapshot.theme.palette)
    expect(view.theme.colors).toEqual(semanticColours(steps))
    // The dark scheme read, so it is the venue's.
    expect(view.theme.colorsDark.background).toBe(CUSTOM_ROLES.dark.background)
    expect(issuesOf(view)).toEqual([])
  })

  it('holds for any roles whatever: every required pair reads (property)', () => {
    const hex = fc
      .integer({ min: 0, max: 0xffffff })
      .map((value) => `#${value.toString(16).padStart(6, '0')}`)
    const scheme = fc.record({
      background: hex,
      surface: hex,
      accent: hex,
      on_accent: hex,
      text: hex,
      muted: hex,
      accent_text: hex,
      border: hex,
    })
    fc.assert(
      fc.property(scheme, scheme, (light, dark) => {
        const view = viewOf(themed({ roles: { light, dark } }))
        expect(issuesOf(view)).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})

describe('R13 theme: the light/dark policy passes through', () => {
  it('carries the snapshot’s scheme', () => {
    for (const scheme of ['auto', 'light', 'dark'] as const) {
      expect(viewOf(themed({ scheme })).theme.scheme).toBe(scheme)
    }
    const f = fixture('custom-roles')
    expect(buildViewModel(f.snapshot, f.overlay, f.context).theme.scheme).toBe('dark')
  })
})
