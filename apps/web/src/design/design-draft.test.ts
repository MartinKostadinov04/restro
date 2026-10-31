// The rules of the Design page's draft (D129): what picking a Style fills and keeps, Undo's steps, and
// what counts as changed.
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  designThemeOf,
  type PremadeStyleId,
  type VenueTheme,
} from '@restro/core'
import { PREMADE_STYLES } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import {
  BURST_MS,
  changed,
  type DesignDraft,
  designOf,
  draftOf,
  historyOf,
  keyOfDraft,
  lookOf,
  lookViewOfDraft,
  type SavedDesign,
  undone,
  valuesOfStyle,
  withBodyFont,
  withHeadingFont,
  withLayout,
  withLogo,
  withStyle,
} from './design-draft'

const COLOURS = { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' }
const LOGO = 'as_0123456789ABCDEFGHIJKL'

const design = {
  ...DEFAULT_DESIGN,
  colors: COLOURS,
  values: {
    ...BASIC_DESIGN_VALUES,
    general: { ...BASIC_DESIGN_VALUES.general, body_font: 'lora' },
  },
  logo_asset_id: LOGO,
} as SavedDesign['design']

const saved: SavedDesign = {
  design,
  theme: designThemeOf(design),
  logo: { assetId: LOGO, url: 'https://example.test/logo' },
}

const editorial = PREMADE_STYLES.editorial
if (editorial === undefined) throw new Error('the Editorial Style has a file')

const opened = draftOf(saved)

const wholeTheme = (draft: DesignDraft): VenueTheme => {
  const { theme } = lookViewOfDraft(draft)
  if (theme === null) throw new Error('the look is whole')
  return theme
}

describe('picking a Style', () => {
  const picked = withStyle(opened, 'editorial')

  it('fills every option from the Style', () => {
    expect(picked.style).toBe('editorial')
    const { general, ...pages } = picked.values
    const { general: styleGeneral, ...stylePages } = editorial.values
    expect(pages).toEqual(stylePages)
    expect(general).toEqual({ ...styleGeneral, body_font: 'lora' })
  })

  it('keeps the colours, the roles, the logo and the body font', () => {
    expect(picked.look).toBe(opened.look)
    expect(picked.logo).toEqual(opened.logo)
    expect(picked.values.general.body_font).toBe('lora')
    const content = designOf(picked, wholeTheme(picked))
    expect(content.colors).toEqual(COLOURS)
    expect(content.logo_asset_id).toBe(LOGO)
  })

  it('fills it in again when the Style is picked again, to start over', () => {
    const edited = withHeadingFont(picked, 'lora')
    expect(edited.values.general.heading_font).toBe('lora')
    expect(withStyle(edited, 'editorial').values.general.heading_font).toBe(
      editorial.values.general.heading_font,
    )
  })

  it('fills every option from Club too, the last premade Style to get a file (#178)', () => {
    const club = PREMADE_STYLES.club
    if (club === undefined) throw new Error('the Club Style has a file')
    expect(withStyle(opened, 'club').values.general.screen).toBe(club.values.general.screen)
  })

  it('leaves the draft as it is for a Style with no file', () => {
    // Every Style the contract lists has a file since #178; an organisation's own Style is a record,
    // and a Style id from nowhere (an older stored design, a hand-edited record) still changes nothing.
    const unknown = 'neon' as PremadeStyleId
    expect(valuesOfStyle(unknown, opened.values)).toBeNull()
    expect(withStyle(opened, unknown)).toBe(opened)
  })
})

describe('the design Done saves', () => {
  it('is the whole draft: the Style, the values, the colours and the logo, and no brand colour', () => {
    const next = withLogo(withBodyFont(withStyle(opened, 'editorial'), 'manrope'), null)
    const content = designOf(next, wholeTheme(next))
    expect(content).toMatchObject({
      style: 'editorial',
      colors: COLOURS,
      logo_asset_id: null,
    })
    expect(content.values.general.body_font).toBe('manrope')
    expect(content).not.toHaveProperty('brand')
  })

  it('writes the layout into the Items page of the values', () => {
    const next = withLayout(opened, { default: 'two', guest_switch: false })
    expect(next.values.items).toMatchObject({ layout: 'two', guest_switch: 'off' })
  })

  it('works out the font, corners, depth and screen from the values, not the look', () => {
    const next = withBodyFont(opened, 'manrope')
    expect(lookOf(next).font).toBe('manrope')
    expect(wholeTheme(next).font).toBe('manrope')
    expect(wholeTheme(next).scheme).toBe(next.values.general.screen)
  })
})

describe('what counts as changed', () => {
  it('nothing, on the page as it opened', () => {
    expect(keyOfDraft(draftOf(saved))).toBe(keyOfDraft(opened))
  })

  it('anything the person changed', () => {
    expect(keyOfDraft(withBodyFont(opened, 'manrope'))).not.toBe(keyOfDraft(opened))
  })

  it('nothing, once a change is taken back', () => {
    const history = changed(historyOf(opened), withBodyFont(opened, 'manrope'), { now: 0 })
    expect(keyOfDraft(undone(history).draft)).toBe(keyOfDraft(opened))
  })

  it('has no key while a box holds half a colour', () => {
    const half = { ...opened, look: { ...opened.look, colours: { ...COLOURS, tertiary: '#25' } } }
    expect(keyOfDraft(half as DesignDraft)).toBeNull()
  })

  it('nothing, on a look saved with one brand colour: it opens as its three colours', () => {
    const brand = { ...DEFAULT_DESIGN, brand: '#e11d48' } as SavedDesign['design']
    const first = draftOf({ design: brand, theme: designThemeOf(brand), logo: null })
    expect(keyOfDraft(first)).not.toBeNull()
    expect(keyOfDraft(first)).toBe(keyOfDraft({ ...first }))
  })
})

describe('Undo', () => {
  const start = historyOf(opened)
  const fontA = withBodyFont(opened, 'manrope')
  const fontB = withBodyFont(fontA, 'inter')

  it('takes back the last step, one at a time, then has nothing to take back', () => {
    const two = changed(changed(start, fontA, { now: 0 }), fontB, { now: 10 })
    const one = undone(two)
    expect(one.draft).toBe(fontA)
    const none = undone(one)
    expect(none.draft).toBe(opened)
    expect(none.past).toEqual([])
    expect(undone(none)).toBe(none)
  })

  it('counts a burst of changes to one control as one step', () => {
    let history = changed(start, fontA, { key: 'colours', now: 0 })
    history = changed(history, fontB, { key: 'colours', now: BURST_MS - 1 })
    expect(history.past).toHaveLength(1)
    expect(undone(history).draft).toBe(opened)
  })

  it('counts a change after a pause, or to another control, as a new step', () => {
    const paused = changed(changed(start, fontA, { key: 'colours', now: 0 }), fontB, {
      key: 'colours',
      now: BURST_MS,
    })
    expect(paused.past).toHaveLength(2)
    const other = changed(changed(start, fontA, { key: 'colours', now: 0 }), fontB, {
      key: 'fonts',
      now: 1,
    })
    expect(other.past).toHaveLength(2)
  })

  it('does not make a step of a change that changes nothing', () => {
    expect(changed(start, { ...opened }, { now: 0 })).toBe(start)
  })

  it('starts a new burst after an Undo', () => {
    const typed = changed(start, fontA, { key: 'colours', now: 0 })
    const back = undone(typed)
    const again = changed(back, fontB, { key: 'colours', now: 1 })
    expect(again.past).toHaveLength(1)
  })
})
