import { describe, expect, it } from 'vitest'

import {
  DESIGN_MARKER_PAGES,
  DESIGN_OPTIONS,
  DESIGN_PAGES,
  type DesignValues,
  DesignValuesSchema,
  PREMADE_STYLES,
  StyleFileSchema,
  StyleValuesSchema,
} from '.'

// The contract's equality with D130 is scripts/design-contract.test.ts's job; this file checks what
// the shell exports from it: the schemas, the Style format, the marker lookup.

/** A design on Basic: every choice option at its first value. */
function basicDesign(): Design {
  const design: Design = {}
  for (const { page, option } of DESIGN_OPTIONS) {
    if (option.kind !== 'choice') continue
    const values = design[page.id] ?? {}
    values[option.id] = option.values[0].id
    design[page.id] = values
  }
  return design
}

type Design = Record<string, Record<string, string>>

function pageOf(design: Design, id: string): Record<string, string> {
  const page = design[id]
  if (page === undefined) throw new Error(`no page ${id}`)
  return page
}

describe('DesignValuesSchema', () => {
  it('accepts a value for every choice option', () => {
    const design = DesignValuesSchema.parse(basicDesign())
    expect(design.items.layout).toBe('list')
    expect(design.general.body_font).toBe('inter')
  })

  it('has one entry for every option but the Style and the colours', () => {
    const count = Object.values(basicDesign()).reduce((n, page) => n + Object.keys(page).length, 0)
    expect(count).toBe(DESIGN_OPTIONS.length - 2)
  })

  it('refuses a value outside the list, an unknown option, a missing option and an unknown page', () => {
    const bad = (change: (design: Design) => void) => {
      const design = basicDesign()
      change(design)
      return DesignValuesSchema.safeParse(design).success
    }
    expect(bad((d) => Object.assign(pageOf(d, 'items'), { layout: 'three' }))).toBe(false)
    expect(bad((d) => Object.assign(pageOf(d, 'items'), { shadow: 'low' }))).toBe(false)
    expect(bad((d) => Reflect.deleteProperty(pageOf(d, 'items'), 'layout'))).toBe(false)
    expect(bad((d) => Object.assign(d, { footer: { colour: 'red' } }))).toBe(false)
    expect(bad(() => {})).toBe(true)
  })

  it('types a value as the union of its option’s values', () => {
    const sample: DesignValues['photos']['shape'][] = ['landscape', 'square', 'wide', 'portrait']
    // @ts-expect-error not a value of the option
    const invalid: DesignValues['photos']['shape'] = 'oval'
    expect([sample.length, invalid]).toEqual([4, 'oval'])
  })
})

describe('StyleValuesSchema', () => {
  it('leaves out the body font, which no Style sets', () => {
    const design = basicDesign()
    Reflect.deleteProperty(pageOf(design, 'general'), 'body_font')
    expect(StyleValuesSchema.safeParse(design).success).toBe(true)
    expect(DesignValuesSchema.safeParse(design).success).toBe(false)
    Object.assign(pageOf(design, 'general'), { body_font: 'lora' })
    expect(StyleValuesSchema.safeParse(design).success).toBe(false)
  })
})

describe('the premade Styles', () => {
  it('pass the Style file schema', () => {
    for (const style of Object.values(PREMADE_STYLES)) {
      expect(StyleFileSchema.safeParse(style).success, style.id).toBe(true)
    }
  })

  it('refuse a Style that names a colour, a logo or an unknown Style', () => {
    const basic = PREMADE_STYLES.basic
    expect(StyleFileSchema.safeParse({ ...basic, colours: ['#fff'] }).success).toBe(false)
    expect(StyleFileSchema.safeParse({ ...basic, id: 'neon' }).success).toBe(false)
  })
})

describe('the contract’s own lists', () => {
  it('finds the page that owns a marker', () => {
    expect(DESIGN_MARKER_PAGES.get('item.price')).toBe('items')
    expect(DESIGN_MARKER_PAGES.get('item.photo')).toBe('photos')
    expect(DESIGN_MARKER_PAGES.get('button')).toBe('general')
    expect(DESIGN_MARKER_PAGES.get('item.state')).toBeUndefined()
    expect(DESIGN_PAGES.flatMap((page) => page.markers)).toHaveLength(DESIGN_MARKER_PAGES.size)
  })
})
