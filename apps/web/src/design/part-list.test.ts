// The Design panel's list of parts, apart from React (D159): which rows each level lists, where an
// address's `?part=` opens, which part the level switch keeps, the options General keeps in
// Advanced, and every row's one-line summary in both languages.
import {
  DEFAULT_DESIGN,
  DESIGN_PAGES,
  type DesignPage,
  designThemeOf,
  styleValuesOf,
} from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  MENU_TOP,
  optionsOfPage,
  previewStageOf,
  tilePlanOf,
  withOptionValue,
} from './advanced-model'
import { type DesignDraft, draftOf, withHeadingFont, withStyle } from './design-draft'
import {
  fontSummaryOf,
  layoutSummaryOf,
  openingOf,
  pageOfPart,
  pageSummaryOf,
  partAcross,
  partListOf,
  styleSummaryOf,
} from './part-list'

const NONE = { saved: [], venues: [] }
const general = DESIGN_PAGES[0]
const page = (id: string) => DESIGN_PAGES.find((entry) => entry.id === id) as DesignPage

function draft(): DesignDraft {
  return draftOf({ design: DEFAULT_DESIGN, theme: designThemeOf(DEFAULT_DESIGN), logo: null })
}

describe('the list of parts', () => {
  it('Simple lists the Style, Colours and logo, Fonts and Layout, and no page', () => {
    expect(partListOf('simple')).toEqual({
      own: ['style', 'colours', 'fonts', 'layout'],
      pages: [],
    })
  })

  it('Advanced lists the Style, colours and fonts, then every page of the contract in its order', () => {
    const list = partListOf('advanced')
    expect(list.own).toEqual(['style', 'colours', 'fonts'])
    expect(list.pages.map((entry) => entry.id)).toEqual(DESIGN_PAGES.map((entry) => entry.id))
    expect(list.pages[0]?.id).toBe('general')
    expect(list.pages).toHaveLength(14)
  })

  it('a page added to the contract is a row, with no code of ours', () => {
    const planted = { ...DESIGN_PAGES[1], id: 'planted', en: 'Planted', bg: 'Засадено' }
    const pages = [...DESIGN_PAGES, planted] as unknown as DesignPage[]
    expect(partListOf('advanced', pages).pages.at(-1)?.id).toBe('planted')
    expect(pageOfPart('planted', pages)).toBe(planted)
    expect(openingOf('planted', 'simple', pages)).toEqual({ mode: 'advanced', part: 'planted' })
  })

  it('General in Advanced holds only its other options: not the Style, the colours or the fonts', () => {
    expect(optionsOfPage(general).map((option) => option.id)).toEqual([
      'screen',
      'heading_weight',
      'corners',
      'depth',
      'density',
      'text_size',
      'buttons',
    ])
    // Every other page keeps every option.
    expect(optionsOfPage(page('items'))).toBe(page('items').options)
  })
})

describe('the address', () => {
  it('opens the part it names, at the level that lists it', () => {
    expect(openingOf(null, 'simple')).toEqual({ mode: 'simple', part: null })
    expect(openingOf('style', 'simple')).toEqual({ mode: 'simple', part: 'style' })
    expect(openingOf('layout', 'simple')).toEqual({ mode: 'simple', part: 'layout' })
    expect(openingOf('items', 'simple')).toEqual({ mode: 'advanced', part: 'items' })
    expect(openingOf('layout', 'advanced')).toEqual({ mode: 'simple', part: 'layout' })
    expect(openingOf('fonts', 'advanced')).toEqual({ mode: 'advanced', part: 'fonts' })
  })

  it('opens the list for a part no level has', () => {
    expect(openingOf('nothing', 'simple')).toEqual({ mode: 'simple', part: null })
    expect(openingOf('', 'advanced')).toEqual({ mode: 'advanced', part: null })
  })
})

describe('the level switch', () => {
  it('keeps the part the other level has, Layout for Items and back, else the list', () => {
    for (const id of ['style', 'colours', 'fonts']) {
      expect(partAcross(id, 'advanced')).toBe(id)
      expect(partAcross(id, 'simple')).toBe(id)
    }
    expect(partAcross('layout', 'advanced')).toBe('items')
    expect(partAcross('items', 'simple')).toBe('layout')
    expect(partAcross('photos', 'simple')).toBeNull()
    expect(partAcross('general', 'simple')).toBeNull()
    expect(partAcross(null, 'advanced')).toBeNull()
  })
})

describe('what the preview shows', () => {
  it('the top of the menu with the list and the panel’s own parts', () => {
    expect(previewStageOf(null)).toBe(MENU_TOP)
    for (const id of ['style', 'colours', 'fonts', 'layout', 'nothing']) {
      expect(previewStageOf(id)).toBe(MENU_TOP)
    }
  })

  it('a page’s part, at its first option’s stage and scrolled to its focus', () => {
    expect(previewStageOf('dish').stage).toBe('dish')
    expect(previewStageOf('bill').stage).toBe('bill')
    expect(previewStageOf('sheets').stage).toBe('bill')
    expect(previewStageOf('call').stage).toBe('call')
    // A part of the menu itself opens nothing: the preview scrolls to it.
    expect(previewStageOf('items')).toEqual({ focus: tilePlanOf('items', 'frame').focus })
    expect(previewStageOf('items').focus.length).toBeGreaterThan(0)
    // General's first option looks at the whole page: the top of the menu.
    expect(previewStageOf('general')).toEqual(MENU_TOP)
  })
})

describe('the summaries', () => {
  it('a part page: the value words of its first two options, in the panel’s language', () => {
    const values = withOptionValue(
      withOptionValue(DEFAULT_DESIGN.values, 'items', 'frame', 'cards'),
      'items',
      'name_size',
      'l',
    )
    expect(pageSummaryOf(page('items'), values, 'en')).toBe('Cards · Large')
    expect(pageSummaryOf(page('items'), values, 'bg')).toBe('Картички · Голям')
    const header = withOptionValue(
      withOptionValue(DEFAULT_DESIGN.values, 'header', 'band', 'page'),
      'header',
      'arrangement',
      'centred',
    )
    expect(pageSummaryOf(page('header'), header, 'en')).toBe('Page colour · Centred')
    expect(pageSummaryOf(page('header'), header, 'bg')).toBe('Цвят на страницата · Центрирана')
  })

  it('General’s summary skips the options that are rows of their own', () => {
    // Screen and Heading weight, not the Style and the colours that come first in the contract.
    const values = withOptionValue(
      withOptionValue(DEFAULT_DESIGN.values, 'general', 'screen', 'dark'),
      'general',
      'heading_weight',
      'bold',
    )
    expect(pageSummaryOf(general, values, 'en')).toBe('Dark · Bold')
    expect(pageSummaryOf(general, values, 'bg')).toBe('Тъмен · Получер')
  })

  it('the Style: its name, and ", changed" once an option differs from it', () => {
    const editorial = withStyle(draft(), 'editorial')
    expect(styleSummaryOf(editorial, NONE, 'en')).toEqual({ name: 'Editorial', changed: false })
    // The body font is the venue's own: changing it is no change to the Style.
    const lora = {
      ...editorial,
      values: withOptionValue(editorial.values, 'general', 'body_font', 'lora'),
    }
    expect(styleSummaryOf(lora, NONE, 'en').changed).toBe(false)
    const framed = {
      ...editorial,
      values: withOptionValue(editorial.values, 'items', 'frame', 'cards'),
    }
    expect(styleSummaryOf(framed, NONE, 'en')).toEqual({ name: 'Editorial', changed: true })
    expect(styleSummaryOf(withHeadingFont(editorial, 'unbounded'), NONE, 'en').changed).toBe(true)
  })

  it('the Style picked from My styles is named by its own name, or the venue it is in use at', () => {
    const base = withStyle(draft(), 'soft')
    const styles = {
      saved: [{ id: 'st_1', name: 'Our classic', values: styleValuesOf(base.values) }],
      venues: [{ venueId: 'vn_1', venueName: 'Club Varna', values: styleValuesOf(base.values) }],
    }
    const saved = { ...base, picked: { kind: 'saved', id: 'st_1' } as const }
    expect(styleSummaryOf(saved, styles, 'en')).toEqual({ name: 'Our classic', changed: false })
    const venue = { ...base, picked: { kind: 'venue', venueId: 'vn_1' } as const }
    expect(styleSummaryOf(venue, styles, 'en')).toEqual({ name: 'Club Varna', changed: false })
    const band = saved.values.header.band === 'ink' ? 'page' : 'ink'
    const edited = { ...saved, values: withOptionValue(saved.values, 'header', 'band', band) }
    expect(styleSummaryOf(edited, styles, 'en')).toEqual({ name: 'Our classic', changed: true })
  })

  it('the fonts: body and heading, the body once when the heading is the same', () => {
    const values = DEFAULT_DESIGN.values
    const lora = withOptionValue(
      withOptionValue(values, 'general', 'body_font', 'lora'),
      'general',
      'heading_font',
      'same',
    )
    expect(fontSummaryOf(lora, 'en')).toEqual({ body: { id: 'lora', name: 'Lora' }, heading: null })
    const paired = withOptionValue(lora, 'general', 'heading_font', 'playfair-display')
    expect(fontSummaryOf(paired, 'en')).toEqual({
      body: { id: 'lora', name: 'Lora' },
      heading: { id: 'playfair-display', name: 'Playfair Display' },
    })
    // A heading font that is the body's own is said once.
    const twice = withOptionValue(lora, 'general', 'heading_font', 'lora')
    expect(fontSummaryOf(twice, 'en').heading).toBeNull()
  })

  it('the layout: the one guests start in, and whether they may switch', () => {
    const values = withOptionValue(
      withOptionValue(DEFAULT_DESIGN.values, 'items', 'layout', 'two'),
      'items',
      'guest_switch',
      'off',
    )
    expect(layoutSummaryOf(values)).toEqual({ layout: 'two', guestSwitch: false })
    expect(
      layoutSummaryOf(withOptionValue(values, 'items', 'guest_switch', 'on')).guestSwitch,
    ).toBe(true)
  })
})
