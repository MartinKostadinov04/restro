// The layout fields of `menu-snapshot/1` (D92; brief S6): a section's `hints.layout` (vertical, or
// horizontal: the face's feature strip) and the menu's `layout` (the layout guests start in and
// whether they may switch it), filled from the design (D129). Both are optional in the schema, so
// a snapshot published before them still validates; the builder always writes them.
import { describe, expect, it } from 'vitest'

import type { DesignValues } from '../design/contract'
import { BASIC_DESIGN_VALUES } from '../design/record'
import { resolve } from '../resolve'
import { CONTEXT, DocBuilder, eur, nd, ROOT, testId, VENUE_ID } from '../resolve/fixtures'
import { DEFAULT_SECTION_LAYOUT, VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import {
  buildSnapshot,
  DEFAULT_MENU_LAYOUT,
  designLayoutOf,
  type SnapshotContext,
  snapshotContentHash,
} from './build'
import { assertSnapshotSafe, collectForbiddenValues } from './leak-guard'
import { MenuSnapshotSchema } from './schema'

// biome-ignore lint/suspicious/noExplicitAny: the tests take fields out of the JSON on purpose
type Poke = Record<string, any>

const PICKS = nd('picks')
const DRINKS = nd('drinks')
const NEGRONI = nd('negroni')
const SPRITZ = nd('spritz')

function context(overrides: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    template: VENUE_MENU_TEMPLATE,
    snapshotId: testId('sn', 'layout'),
    version: 1,
    publishedAt: '2026-10-13T21:00:00+03:00',
    menuId: ROOT,
    venueId: VENUE_ID,
    edition: ['master', `venue:${VENUE_ID}`],
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    currency: 'EUR',
    assets: {},
    tagVocabulary: {},
    ...overrides,
  }
}

/** Top picks (marked horizontal by the composer) and drinks (never set). */
function menu(): DocBuilder {
  const builder = new DocBuilder()
    .section(PICKS, ROOT, 'active', 'a0')
    .section(DRINKS, ROOT, 'active', 'a1')
    .tillItem(NEGRONI, 1250)
    .tillItem(SPRITZ, 900)
    .place(NEGRONI, PICKS, 'a0')
    .place(SPRITZ, DRINKS, 'a0')
  builder.set(PICKS, 'layout', 'manual', 'horizontal')
  return builder
}

/** A design with these Items words. */
const designWith = (
  layout: DesignValues['items']['layout'],
  guest_switch: DesignValues['items']['guest_switch'],
): DesignValues => ({
  ...BASIC_DESIGN_VALUES,
  items: { ...BASIC_DESIGN_VALUES.items, layout, guest_switch },
})

const snapshotOf = (builder: DocBuilder, ctx = context()) =>
  buildSnapshot(resolve(VENUE_MENU_TEMPLATE, builder.build(), CONTEXT), ctx)

describe('section layout (hints.layout)', () => {
  it('the template declares it: an enum of vertical and horizontal, vertical by default, ours', () => {
    const field = VENUE_MENU_TEMPLATE.nodeTypes.section?.fields.find((def) => def.key === 'layout')
    expect(field).toMatchObject({
      type: 'enum',
      options: ['vertical', 'horizontal'],
      default: 'vertical',
      owner: 'builder',
      overridable: 'never',
      visibility: 'public',
    })
    expect(DEFAULT_SECTION_LAYOUT).toBe('vertical')
  })

  it('publishes a section marked horizontal as horizontal, and one never set as vertical', () => {
    const snapshot = snapshotOf(menu())
    expect(snapshot.sections[PICKS]?.hints).toEqual({
      color: null,
      icon: null,
      layout: 'horizontal',
    })
    expect(snapshot.sections[DRINKS]?.hints.layout).toBe('vertical')
  })

  it('any section can be horizontal, not only the first', () => {
    const builder = menu()
    builder.set(PICKS, 'layout', 'manual', 'vertical')
    builder.set(DRINKS, 'layout', 'manual', 'horizontal')
    const snapshot = snapshotOf(builder)
    expect(snapshot.sections[PICKS]?.hints.layout).toBe('vertical')
    expect(snapshot.sections[DRINKS]?.hints.layout).toBe('horizontal')
  })
})

describe('menu layout (layout)', () => {
  it('without a design: two columns, and guests may switch (only a builder test meets this)', () => {
    expect(DEFAULT_MENU_LAYOUT).toEqual({ default: 'two', guest_switch: true })
    expect(snapshotOf(menu()).layout).toEqual({ default: 'two', guest_switch: true })
    expect(snapshotOf(menu(), context({ design: null })).layout).toEqual(DEFAULT_MENU_LAYOUT)
  })

  it('carries the design’s layout and guest switch', () => {
    const snapshot = snapshotOf(menu(), context({ design: designWith('one', 'off') }))
    expect(snapshot.layout).toEqual({ default: 'one', guest_switch: false })
  })

  it('designLayoutOf reads the Items page, the switch as a boolean', () => {
    expect(designLayoutOf(BASIC_DESIGN_VALUES)).toEqual({ default: 'list', guest_switch: true })
    expect(designLayoutOf(designWith('two', 'off'))).toEqual({
      default: 'two',
      guest_switch: false,
    })
  })

  it('changes the content hash, so a new layout is a new snapshot', () => {
    const one = snapshotOf(menu(), context({ design: designWith('one', 'on') }))
    const list = snapshotOf(menu(), context({ design: designWith('list', 'on') }))
    expect(list.snapshot.hash).not.toBe(one.snapshot.hash)
  })
})

describe('the schema', () => {
  it('still validates a snapshot published before the layout fields', () => {
    const snapshot = snapshotOf(menu()) as Poke
    const { layout: _layout, ...withoutLayout } = snapshot
    for (const section of Object.values(withoutLayout.sections as Poke)) {
      delete section.hints.layout
    }
    withoutLayout.snapshot.hash = snapshotContentHash(withoutLayout as never)
    expect(MenuSnapshotSchema.safeParse(withoutLayout).success).toBe(true)
  })

  it('refuses a layout that is not one of the words', () => {
    const badSection = snapshotOf(menu()) as Poke
    badSection.sections[PICKS].hints.layout = 'diagonal'
    expect(MenuSnapshotSchema.safeParse(badSection).success).toBe(false)

    for (const layout of [
      { default: 'grid', guest_switch: false },
      { default: 'two' },
      { default: 'two', guest_switch: 'yes' },
      { default: 'two', guest_switch: true, extra: 1 },
    ]) {
      const badMenu = snapshotOf(menu()) as Poke
      badMenu.layout = layout
      expect(MenuSnapshotSchema.safeParse(badMenu).success, JSON.stringify(layout)).toBe(false)
    }
  })
})

describe('the leak guard', () => {
  it('an internal note that reads like a layout word never blocks the publish', () => {
    const builder = menu()
    builder.set(NEGRONI, 'internal_note', 'manual', 'horizontal')
    builder.set(SPRITZ, 'internal_note', 'manual', 'two')
    builder.set(SPRITZ, 'price', 'manual', eur(950))
    const doc = builder.build()
    const snapshot = buildSnapshot(
      resolve(VENUE_MENU_TEMPLATE, doc, CONTEXT),
      context({ design: designWith('two', 'on') }),
    )
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc,
      externalIds: [],
    })
    expect(() => assertSnapshotSafe(snapshot, forbidden)).not.toThrow()
  })
})
