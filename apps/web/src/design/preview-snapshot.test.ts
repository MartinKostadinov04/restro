// The draft with the unsaved look laid over it (brief SH-05a): the same colours, font, corners,
// shadow, policy and template the publisher would write, and nothing else changed.
import { paletteList, themePaletteOf, themeRolesOf, VenueThemeSchema } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { previewSnapshot } from './preview-snapshot'

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

describe('the preview snapshot', () => {
  const made = previewSnapshot(draft, {
    theme,
    face: 'editorial-market',
    options: { layout: 'one' },
  })

  it('carries the roles of both screens, the font family, corners, shadow and policy', () => {
    expect(made.theme.roles).toEqual(themeRolesOf(theme))
    expect(made.theme.palette).toEqual(paletteList(themePaletteOf(theme)))
    expect(made.theme.font).toBe('Playfair Display')
    expect(made.theme.radius).toBe(18)
    expect(made.theme.shadow).toBe(4)
    expect(made.theme.scheme).toBe('dark')
  })

  it('names the template and its options', () => {
    expect(made.presentation).toEqual({ face: 'editorial-market', options: { layout: 'one' } })
  })

  it('leaves the logo and the menu as the draft has them, and the draft itself unchanged', () => {
    expect(made.theme.logo).toBe(draft.theme.logo)
    expect(made.items).toBe(draft.items)
    expect(made.sections).toBe(draft.sections)
    expect(draft.theme.font).not.toBe('Playfair Display')
  })
})
