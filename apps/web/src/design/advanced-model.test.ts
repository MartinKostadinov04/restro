import { DEFAULT_DESIGN, DESIGN_PAGES } from '@restro/core'
import { SPECIMEN_PARTS } from '@restro/editorial-market/preview'
import { describe, expect, it } from 'vitest'

import {
  PART_OF_OPTION,
  pageOfMarker,
  rowStateOf,
  specimenPartOf,
  tilePlanOf,
  valueIn,
  withOptionValue,
} from './advanced-model'

const values = DEFAULT_DESIGN.values

describe('the page a marker opens', () => {
  it('every marker the contract lists opens the page that lists it', () => {
    for (const page of DESIGN_PAGES) {
      for (const marker of page.markers) expect(pageOfMarker(marker)).toBe(page.id)
    }
  })

  it('a marker the contract does not name takes its parent, else nothing', () => {
    expect(pageOfMarker('item.photo.corner')).toBe('photos')
    expect(pageOfMarker('header.logo.mark')).toBe('header')
    expect(pageOfMarker('nothing')).toBeNull()
  })
})

describe('setting one option', () => {
  it('changes that value and no other', () => {
    const next = withOptionValue(values, 'items', 'frame', 'cards')
    expect(valueIn(next, 'items', 'frame')).toBe('cards')
    expect(next.items).toEqual({ ...values.items, frame: 'cards' })
    expect(next.photos).toBe(values.photos)
  })
})

describe('rows that do not apply', () => {
  it('Photo corners are off while the Frame is edge to edge', () => {
    const bleed = withOptionValue(values, 'photos', 'frame', 'bleed')
    expect(rowStateOf(bleed, 'photos', 'corners')).toEqual({
      disabled: true,
      note: { kind: 'bleed' },
    })
    const inset = withOptionValue(values, 'photos', 'frame', 'inset')
    expect(rowStateOf(inset, 'photos', 'corners').disabled).toBe(false)
  })

  it("the rail's Band is off while the header's band is the page colour: both values draw alike", () => {
    const page = withOptionValue(values, 'header', 'band', 'page')
    expect(rowStateOf(page, 'navigation', 'band')).toEqual({
      disabled: true,
      note: { kind: 'page-band' },
    })
    for (const band of ['panel', 'ink'])
      expect(
        rowStateOf(withOptionValue(values, 'header', 'band', band), 'navigation', 'band'),
      ).toEqual({
        disabled: false,
        note: null,
      })
  })

  it('the weight rows note a font that stops short of Heavy, on the font that draws', () => {
    const lora = withOptionValue(values, 'general', 'body_font', 'lora')
    const same = withOptionValue(lora, 'general', 'heading_font', 'same')
    expect(rowStateOf(same, 'general', 'heading_weight').note).toMatchObject({
      kind: 'heavy',
      font: 'Lora',
    })
    expect(rowStateOf(same, 'items', 'name_weight').note).toMatchObject({ kind: 'heavy' })
    // A heading font of its own is the one that counts.
    const inter = withOptionValue(same, 'general', 'heading_font', 'inter')
    expect(rowStateOf(inter, 'general', 'heading_weight').note).toBeNull()
    expect(rowStateOf(same, 'general', 'corners').note).toBeNull()
  })
})

describe('what a tile draws', () => {
  it('the five guest-feature pages draw their own screen', () => {
    expect(tilePlanOf('call', 'kinds').stage).toBe('call')
    expect(tilePlanOf('bill', 'rows').stage).toBe('bill')
    expect(tilePlanOf('order', 'add_control').stage).toBe('order')
    expect(tilePlanOf('order', 'line_photos').stage).toBe('bag')
    expect(tilePlanOf('pay', 'tip').stage).toBe('pay')
    expect(tilePlanOf('receipt', 'venue_block').stage).toBe('receipt')
  })

  it('a browsing page draws the top of the menu, looking at its own part', () => {
    expect(tilePlanOf('items', 'frame')).toEqual({ stage: 'menu', focus: ['item', 'item.name'] })
    expect(tilePlanOf('general', 'corners')).toEqual({ stage: 'menu', focus: [] })
    expect(tilePlanOf('items', 'name_size').focus).toEqual(['item.name'])
    expect(tilePlanOf('dish', 'kind').stage).toBe('dish')
  })
})

describe('the part an option draws (D159)', () => {
  const keys = DESIGN_PAGES.flatMap((page) =>
    page.options.map((option) => `${page.id}.${option.id}`),
  )

  it('every option of the contract has a row, and the table names no option the contract lacks', () => {
    // An option added to the contract with no part fails here until it is given one (or null).
    expect([...keys].sort()).toEqual(Object.keys(PART_OF_OPTION).sort())
  })

  it('only the four look-wide options draw no part; every part is one the specimen view draws', () => {
    const none = keys.filter((key) => PART_OF_OPTION[key] === null)
    expect(none.sort()).toEqual(
      ['general.body_font', 'general.colours', 'general.heading_font', 'general.style'].sort(),
    )
    for (const key of keys) {
      const part = PART_OF_OPTION[key]
      if (part !== null && part !== undefined) expect(SPECIMEN_PARTS, key).toContain(part)
    }
  })

  it('Items › Name size draws one dish row; Header › Band draws the header', () => {
    expect(specimenPartOf('items', 'name_size')).toBe('dish-row')
    expect(specimenPartOf('header', 'band')).toBe('header')
    expect(specimenPartOf('nothing', 'here')).toBeNull()
  })
})
