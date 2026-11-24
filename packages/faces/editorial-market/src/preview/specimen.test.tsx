// @vitest-environment jsdom

// The specimen view (D159): each part draws that part and not the page around it. The header and
// the section rail appear only in the parts that are about them, a dish part draws just its dishes,
// and a sheet's part draws its body with the demo host's state.

import type { ViewModel } from '@restro/shell'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { orderingView, resetPage } from '../services/test-kit'
import { richView } from '../test-views'
import { useDemoServices } from './demo-services'
import {
  EditorialSpecimen,
  SPECIMEN_FIXED_PARTS,
  SPECIMEN_PARTS,
  type SpecimenPart,
  specimenNeedsHost,
  specimenNeedsServices,
} from './specimen'

beforeEach(() => {
  resetPage()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

function Hosted({ view, part }: { view: ViewModel; part: SpecimenPart }) {
  return <EditorialSpecimen view={view} part={part} services={useDemoServices(view)} />
}

/** The part drawn as the Design panel's frame draws it: the demo host only for a sheet's body. */
function draw(part: SpecimenPart) {
  const view = specimenNeedsServices(part) ? orderingView() : richView()
  const { container } = render(
    specimenNeedsHost(part) ? (
      <Hosted view={view} part={part} />
    ) : (
      <EditorialSpecimen view={view} part={part} />
    ),
  )
  const count = (marker: string) =>
    container.querySelectorAll(`[data-design-part="${marker}"]`).length
  return { container, count }
}

/** What each part must draw (a marker, or a selector in brackets), at least once. */
const DRAWS: Record<SpecimenPart, readonly string[]> = {
  header: ['header', 'header.title'],
  rail: ['nav'],
  'header-rail': ['header', 'nav'],
  section: ['section.title', 'item'],
  'section-two': ['section.title', 'item'],
  switch: ['section.title', 'layout.switch', 'item'],
  'dish-row': ['item', 'item.name'],
  'dish-rows': ['item'],
  'two-dishes': ['item'],
  'four-dishes': ['item'],
  'dish-long': ['item.description'],
  'dish-allergens': ['item', 'footer'],
  'dish-card': ['item', 'item.add'],
  'dish-add': ['item', 'item.add'],
  strip: ['strip'],
  'dish-open': ['dish'],
  'order-bar': ['order.bar'],
  'call-sheet': ['sheet', 'call'],
  'call-kinds': ['call.kinds'],
  'call-foot': ['call', 'button'],
  'bill-lines': ['bill.lines', 'bill.total'],
  'bag-lines': ['order'],
  tip: ['pay.tip'],
  'receipt-top': ['receipt', 'receipt.venue'],
}

/** How many dishes a dish part draws. */
const DISH_COUNT: Partial<Record<SpecimenPart, number>> = {
  section: 1,
  'section-two': 2,
  'dish-row': 1,
  'dish-rows': 3,
  'two-dishes': 2,
  'four-dishes': 4,
  'dish-long': 1,
  'dish-card': 1,
  'dish-add': 1,
}

const HEADER_PARTS: ReadonlySet<SpecimenPart> = new Set(['header', 'header-rail'])
const RAIL_PARTS: ReadonlySet<SpecimenPart> = new Set(['rail', 'header-rail'])

describe('the specimen view draws one part', () => {
  for (const part of SPECIMEN_PARTS) {
    it(`${part}: its part, and no header or rail unless it is about them`, () => {
      const { container, count } = draw(part)
      const root = container.querySelector('[data-specimen]')
      expect(root?.getAttribute('data-specimen')).toBe(part)
      for (const marker of DRAWS[part]) {
        expect(count(marker), `${part} draws ${marker}`).toBeGreaterThan(0)
      }
      expect(count('header') > 0, `${part} and the header`).toBe(HEADER_PARTS.has(part))
      expect(count('nav') > 0, `${part} and the rail`).toBe(RAIL_PARTS.has(part))
      expect(count('footer') > 0, `${part} and the footer`).toBe(part === 'dish-allergens')
      const dishes = DISH_COUNT[part]
      if (dishes !== undefined) expect(count('item'), `${part}'s dishes`).toBe(dishes)
    })
  }

  it('Items › Name size (one dish row) draws no header and no section rail', () => {
    const { count } = draw('dish-row')
    expect(count('header')).toBe(0)
    expect(count('nav')).toBe(0)
    expect(count('item')).toBe(1)
  })

  it('Header › Band (the header) draws the header and no dish', () => {
    const { count } = draw('header')
    expect(count('header')).toBe(1)
    expect(count('item')).toBe(0)
    expect(count('section')).toBe(0)
  })

  it('the same dish leads every dish part', () => {
    const first = (part: SpecimenPart) => {
      const { container } = draw(part)
      const id = container.querySelector('[data-item]')?.getAttribute('data-item')
      cleanup()
      return id
    }
    const lead = first('dish-row')
    expect(lead).toBeTruthy()
    for (const part of ['section', 'dish-rows', 'dish-long', 'four-dishes'] as const) {
      expect(first(part), part).toBe(lead)
    }
  })

  it('carries the design as the face does, and a card part draws its dish as a card', () => {
    const view = richView()
    const { container } = render(
      <EditorialSpecimen
        view={{
          ...view,
          design: { ...view.design, items: { ...view.design.items, frame: 'rows' } },
        }}
        part="dish-card"
      />,
    )
    expect(container.querySelector('[data-specimen]')?.getAttribute('data-items-frame')).toBe(
      'cards',
    )
  })

  it('the open bag of Order › Line photos holds two lines', () => {
    const { container } = draw('bag-lines')
    expect(container.querySelectorAll('.ro-lines li.ro-orderline')).toHaveLength(2)
  })

  it('tells its height, and a whole-screen part fills the frame instead', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 123.4,
      width: 320,
      top: 0,
      left: 0,
      right: 320,
      bottom: 123.4,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const heights: number[] = []
    render(
      <EditorialSpecimen view={richView()} part="dish-row" onHeight={(h) => heights.push(h)} />,
    )
    expect(heights).toEqual([124])
    cleanup()
    const fixed: number[] = []
    const part = [...SPECIMEN_FIXED_PARTS][0] as SpecimenPart
    render(<EditorialSpecimen view={richView()} part={part} onHeight={(h) => fixed.push(h)} />)
    expect(fixed).toEqual([])
  })
})
