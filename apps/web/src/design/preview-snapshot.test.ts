// The draft with the unsaved design laid over it (D129): the same colours, font, corners, shadow,
// policy, option values and layout the publisher would write, and nothing else changed.
import {
  BASIC_DESIGN_VALUES,
  type DesignValues,
  paletteList,
  themePaletteOf,
  themeRolesOf,
  VenueThemeSchema,
} from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { previewSnapshot, specimenSnapshot } from './preview-snapshot'

const draft = fixture('with-images').snapshot

const theme = VenueThemeSchema.parse({
  logo_asset_id: null,
  preset: 'midnight',
  colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
  font: 'playfair-display',
  radius: 18,
  shadow: 4,
  scheme: 'dark',
})

const values: DesignValues = {
  ...BASIC_DESIGN_VALUES,
  items: { ...BASIC_DESIGN_VALUES.items, layout: 'one', guest_switch: 'off' },
}

describe('the preview snapshot', () => {
  const made = previewSnapshot(draft, theme, values)

  it('carries the roles of both screens, the font family, corners, shadow and policy', () => {
    expect(made.theme.roles).toEqual(themeRolesOf(theme))
    expect(made.theme.palette).toEqual(paletteList(themePaletteOf(theme)))
    expect(made.theme.font).toBe('Playfair Display')
    expect(made.theme.radius).toBe(18)
    expect(made.theme.shadow).toBe(4)
    expect(made.theme.scheme).toBe('dark')
  })

  it('carries every option’s value and the layout they say', () => {
    expect(made.design).toEqual(values)
    expect(made.layout).toEqual({ default: 'one', guest_switch: false })
  })

  it('takes a removed logo away at once', () => {
    const withLogo = { ...draft, theme: { ...draft.theme, logo: 'as_0123456789ABCDEFGHIJKL' } }
    const logoOf = (logo_asset_id: string | null) =>
      previewSnapshot(withLogo as typeof draft, { ...theme, logo_asset_id } as typeof theme, values)
        .theme.logo
    expect(logoOf(null)).toBeNull()
    expect(logoOf('as_0123456789ABCDEFGHIJKL')).toBe(withLogo.theme.logo)
  })

  it('leaves the draft’s template alone: it names none of its own (D129)', () => {
    expect(made.presentation).toEqual(draft.presentation)
  })

  it('leaves the logo and the menu as the draft has them, and the draft itself unchanged', () => {
    expect(made.theme.logo).toBe(draft.theme.logo)
    expect(made.items).toBe(draft.items)
    expect(made.sections).toBe(draft.sections)
    expect(draft.theme.font).not.toBe('Playfair Display')
  })
})

describe('a Style tile’s specimen', () => {
  const specimen = specimenSnapshot(draft)

  it('keeps the top of the menu and no more', () => {
    expect(specimen.menu.sections).toEqual(draft.menu.sections.slice(0, 2))
    for (const section of Object.values(specimen.sections)) {
      expect(section?.items.length).toBeLessThanOrEqual(4)
    }
  })

  it('leaves the draft itself alone', () => {
    expect(specimen.items).toBe(draft.items)
    expect(draft.menu.sections.length).toBeGreaterThanOrEqual(specimen.menu.sections.length)
  })
})
