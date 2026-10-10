// diffSnapshots on hand-made menus (brief S3-05): what counts as a change waiting to be published.
import { describe, expect, it } from 'vitest'

import { resolve } from '../resolve'
import { CONTEXT, DocBuilder, eur, nd, ROOT, testId, VENUE_ID } from '../resolve/fixtures'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { buildSnapshot, DEFAULT_THEME, type SnapshotContext } from './build'
import { diffSnapshots } from './diff'
import type { MenuSnapshot } from './schema'

const COCKTAILS = nd('cocktails')
const WINES = nd('wines')
const NEGRONI = nd('negroni')
const SPRITZ = nd('spritz')
const MERLOT = nd('merlot')

function context(overrides: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    template: VENUE_MENU_TEMPLATE,
    snapshotId: testId('sn', 'one'),
    version: 1,
    publishedAt: '2026-10-09T21:00:00+03:00',
    menuId: ROOT,
    venueId: VENUE_ID,
    edition: ['master', `venue:${VENUE_ID}`, 'service:2026-10-09'],
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    currency: 'EUR',
    assets: {},
    tagVocabulary: {},
    ...overrides,
  }
}

/** Two sections, three items: Negroni and Spritz (barsy, priced), Merlot (by hand). */
function bar(change: (builder: DocBuilder) => void = () => {}): DocBuilder {
  const builder = new DocBuilder()
    .section(COCKTAILS, ROOT, 'active', 'a0')
    .section(WINES, ROOT, 'active', 'a1')
    .barsyItem(NEGRONI, 1250)
    .barsyItem(SPRITZ, 900)
    .item(MERLOT)
    .place(NEGRONI, COCKTAILS, 'a0')
    .place(SPRITZ, COCKTAILS, 'a1')
    .place(MERLOT, WINES, 'a0')
  builder.set(SPRITZ, 'name', 'barsy', { bg_BG: 'Шприц', en_US: 'Spritz' })
  builder.set(MERLOT, 'name', 'manual', { bg_BG: 'Мерло', en_US: 'Merlot' })
  builder.set(MERLOT, 'price', 'manual', eur(3200))
  builder.set(MERLOT, 'allergens', 'manual', ['sulphites'])
  change(builder)
  return builder
}

function snapshotOf(builder: DocBuilder, ctx = context()): MenuSnapshot {
  return buildSnapshot(resolve(VENUE_MENU_TEMPLATE, builder.build(), CONTEXT), ctx)
}

const live = () => snapshotOf(bar())

describe('diffSnapshots', () => {
  it('finds nothing between identical menus', () => {
    const diff = diffSnapshots(live(), snapshotOf(bar()))
    expect(diff.total).toBe(0)
    expect(diff).toMatchObject({ added: [], hidden: [], priceChanged: [], areas: [] })
    expect(diff.previouslyVisible).toBe(3)
  })

  it('ignores the id, version and time of the snapshot: only content counts', () => {
    const later = snapshotOf(bar(), context({ snapshotId: testId('sn', 'two'), version: 9 }))
    expect(diffSnapshots(live(), later).total).toBe(0)
  })

  it('with nothing published yet, every item is new', () => {
    const diff = diffSnapshots(null, live())
    // By name in the menu's default language: Мерло, Негрони, Шприц.
    expect(diff.added.map((item) => item.id)).toEqual([MERLOT, NEGRONI, SPRITZ])
    expect(diff.total).toBe(3)
    expect(diff.hidden).toEqual([])
  })

  it('a price change is one change, with the old and the new price', () => {
    const next = snapshotOf(bar((b) => b.set(MERLOT, 'price', 'manual', eur(3500))))
    const diff = diffSnapshots(live(), next)
    expect(diff.total).toBe(1)
    expect(diff.priceChanged).toEqual([
      { id: MERLOT, name: { bg_BG: 'Мерло', en_US: 'Merlot' }, from: eur(3200), to: eur(3500) },
    ])
    expect(diff.renamed).toEqual([])
    expect(diff.otherChanged).toEqual([])
  })

  it('a new name is a rename', () => {
    const next = snapshotOf(
      bar((b) => b.set(MERLOT, 'name', 'manual', { bg_BG: 'Мерло резерва', en_US: 'Merlot' })),
    )
    const diff = diffSnapshots(live(), next)
    expect(diff.total).toBe(1)
    expect(diff.renamed).toEqual([
      {
        id: MERLOT,
        from: { bg_BG: 'Мерло', en_US: 'Merlot' },
        to: { bg_BG: 'Мерло резерва', en_US: 'Merlot' },
      },
    ])
  })

  it('an item changed in a price and a name still counts once', () => {
    const next = snapshotOf(
      bar((b) => {
        b.set(MERLOT, 'name', 'manual', { bg_BG: 'Мерло резерва', en_US: 'Merlot' })
        b.set(MERLOT, 'price', 'manual', eur(3500))
      }),
    )
    const diff = diffSnapshots(live(), next)
    expect(diff.total).toBe(1)
    expect(diff.priceChanged).toHaveLength(1)
    expect(diff.renamed).toHaveLength(1)
  })

  it('a hidden item is listed with its live name, and with the V11 numbers', () => {
    const next = snapshotOf(bar((b) => b.set(SPRITZ, 'visible', 'manual', false)))
    const diff = diffSnapshots(live(), next)
    expect(diff.total).toBe(1)
    expect(diff.hidden).toEqual([{ id: SPRITZ, name: { bg_BG: 'Шприц', en_US: 'Spritz' } }])
    expect(diff.hiddenShare).toBeCloseTo(1 / 3)
    expect(diff.previouslyVisible).toBe(3)
    // Hiding an item is not also "the sections changed".
    expect(diff.areas).toEqual([])
  })

  it('an item deleted from the document reads as hidden, since both leave the menu', () => {
    const next = snapshotOf(bar((b) => b.status(SPRITZ, 'archived')))
    expect(diffSnapshots(live(), next).hidden.map((item) => item.id)).toEqual([SPRITZ])
  })

  it('a new item is added, and that is not "the sections changed" either', () => {
    const coffee = nd('coffee')
    const next = snapshotOf(
      bar((b) => {
        b.barsyItem(coffee, 300).place(coffee, COCKTAILS, 'a2')
        b.set(coffee, 'name', 'barsy', { bg_BG: 'Кафе', en_US: 'Coffee' })
      }),
    )
    const diff = diffSnapshots(live(), next)
    expect(diff.added.map((item) => item.id)).toEqual([coffee])
    expect(diff.areas).toEqual([])
    expect(diff.total).toBe(1)
  })

  it('a description or photo change is "changed in another way"', () => {
    const next = snapshotOf(
      bar((b) => b.set(MERLOT, 'description', 'manual', { en_US: 'A red wine' })),
    )
    const diff = diffSnapshots(live(), next)
    expect(diff.otherChanged.map((item) => item.id)).toEqual([MERLOT])
    expect(diff.priceChanged).toEqual([])
    expect(diff.renamed).toEqual([])
  })

  it('a renamed section, a moved item and a new menu title are changes outside the items', () => {
    const renamedSection = snapshotOf(
      bar((b) => b.set(WINES, 'title', 'manual', { bg_BG: 'Вина', en_US: 'Wines' })),
    )
    expect(diffSnapshots(live(), renamedSection).areas).toEqual(['sections'])

    const moved = snapshotOf(
      bar((b) => {
        const at = b.placements.findIndex((placement) => placement.itemId === SPRITZ)
        b.placements[at] = { itemId: SPRITZ, sectionId: WINES, sortKey: 'a1' }
      }),
    )
    expect(diffSnapshots(live(), moved).areas).toEqual(['sections'])

    const retitled = snapshotOf(
      bar((b) => b.set(ROOT, 'title', 'manual', { bg_BG: 'Бар Плаж', en_US: 'Beach Bar' })),
    )
    const diff = diffSnapshots(live(), retitled)
    expect(diff.areas).toEqual(['menu'])
    expect(diff.total).toBe(1)
  })

  it('a new look (the theme) is a change outside the items', () => {
    const next = snapshotOf(
      bar(),
      context({ theme: { ...DEFAULT_THEME, font: 'Inter', radius: 12 } }),
    )
    const base = snapshotOf(bar(), context({ theme: { ...DEFAULT_THEME, radius: 4 } }))
    expect(diffSnapshots(base, next).areas).toEqual(['look'])
  })

  it('sorts the lists by name in the menu default language', () => {
    const next = snapshotOf(
      bar((b) => {
        b.set(NEGRONI, 'price', 'barsy', eur(1300), { scope: `venue:${VENUE_ID}` })
        b.set(SPRITZ, 'price', 'barsy', eur(950), { scope: `venue:${VENUE_ID}` })
      }),
    )
    const diff = diffSnapshots(live(), next)
    expect(diff.priceChanged.map((item) => item.id)).toEqual([NEGRONI, SPRITZ])
    expect(diff.total).toBe(2)
  })
})
