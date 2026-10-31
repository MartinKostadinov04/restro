// The venue's General look for the provider's card form (#258, D130): read from the view model the
// page builds from the published snapshot, so it holds the venue's own colours, font, corners,
// density, text size and sheet colour, and needs no database (rule 4).

import { buildViewModel, type ViewModel } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { describe, expect, it } from 'vitest'

import { plainFontStack } from '../fonts'
import { cardFormLookOf } from './card-form-look'

const f = fixture('no-images')
const view = buildViewModel(f.snapshot, f.overlay, f.context)

describe('the look the card form is given', () => {
  it("is the view's colours of both screens, the screen policy, the corners and the design's values", () => {
    const look = cardFormLookOf(view, (family) => `stack of ${family}`)
    expect(look.colors).toBe(view.theme.colors)
    expect(look.colorsDark).toBe(view.theme.colorsDark)
    expect(look.scheme).toBe(view.theme.scheme)
    expect(look.radius).toBe(view.theme.radius)
    expect(look.fontFamily).toBe(`stack of ${view.theme.font}`)
    expect(look.density).toBe(view.design.general.density)
    expect(look.textSize).toBe(view.design.general.text_size)
    expect(look.sheet).toBe(view.design.sheets.sheets)
  })

  it('follows the venue’s choices, not a default', () => {
    const chosen: ViewModel = {
      ...view,
      theme: { ...view.theme, scheme: 'dark', radius: 22 },
      design: {
        ...view.design,
        general: { ...view.design.general, density: 'spacious', text_size: 'large' },
        sheets: { sheets: 'ink' },
      },
    }
    expect(cardFormLookOf(chosen, plainFontStack)).toMatchObject({
      scheme: 'dark',
      radius: 22,
      density: 'spacious',
      textSize: 'large',
      sheet: 'ink',
    })
  })

  it('carries a font stack the provider’s frame can read: no CSS variable', () => {
    const look = cardFormLookOf(view, plainFontStack)
    expect(look.fontFamily).not.toContain('var(')
    expect(look.fontFamily).toContain(`"${view.theme.font}"`)
  })
})
