import { describe, expect, it } from 'vitest'

import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import {
  CONTEXT,
  DocBuilder,
  eur,
  nd,
  OTHER_VENUE,
  oneItemMenu,
  ROOT,
  testId,
  VENUE,
} from './fixtures'
import { resolve } from './resolve'
import type { Issue, ResolveContext, ResolvedMenu } from './types'

const ITEM = nd('negroni')
const SECTION = nd('cocktails')

function run(builder: DocBuilder, context: Partial<ResolveContext> = {}): ResolvedMenu {
  return resolve(VENUE_MENU_TEMPLATE, builder.build(), { ...CONTEXT, ...context })
}

function item(menu: ResolvedMenu, id = ITEM) {
  const found = menu.items[id]
  if (found === undefined) throw new Error(`no item ${id}`)
  return found
}

function codes(issues: readonly Issue[]): string[] {
  return issues.map((issue) => issue.code)
}

describe('a complete barsy item', () => {
  it('resolves visible and orderable with barsy provenance', () => {
    const menu = run(oneItemMenu())
    const negroni = item(menu)
    expect(negroni.visible).toBe(true)
    expect(negroni.computed).toEqual({ orderable: true, priceFrom: null, badges: [] })
    expect(negroni.fields.name).toMatchObject({ provenance: 'barsy', layer: 'barsy' })
    expect(negroni.fields.price).toEqual({ value: eur(1250), provenance: 'locked', layer: 'barsy' })
    expect(negroni.fields.order_mode).toEqual({
      value: 'orderable',
      provenance: 'none',
      layer: 'default',
    })
    expect(negroni.issues).toEqual([])
    expect(menu.issues).toEqual([])
    expect(menu.sections).toEqual([
      {
        id: SECTION,
        fields: expect.any(Object),
        children: [],
        itemIds: [ITEM],
        visible: true,
        issues: [],
      },
    ])
  })

  it('lists every public field in template order and never an internal one', () => {
    const builder = oneItemMenu().set(ITEM, 'internal_note', 'manual', 'cost 3 EUR')
    const keys = Object.keys(item(run(builder)).fields)
    expect(keys).toEqual([
      'name',
      'description',
      'price',
      'image',
      'allergens',
      'dietary',
      'portion',
      'abv',
      'tags',
      'availability',
      'order_mode',
      'for_sale',
      'visible',
    ])
  })
})

describe('ownership matrix (Item)', () => {
  it('name: barsy, display override allowed, stale when barsy changes → review', () => {
    const fresh = oneItemMenu().set(
      ITEM,
      'name',
      'override',
      { en_US: 'Classic Negroni' },
      { basis: { bg_BG: 'Негрони', en_US: 'Negroni' } },
    )
    expect(item(run(fresh)).fields.name?.value).toEqual({
      bg_BG: 'Негрони',
      en_US: 'Classic Negroni',
    })
    const stale = oneItemMenu().set(
      ITEM,
      'name',
      'override',
      { en_US: 'Classic Negroni' },
      { basis: { bg_BG: 'Старо', en_US: 'Negroni' } },
    )
    const menu = run(stale)
    expect(item(menu).fields.name?.locales?.en_US?.provenance).toBe('stale')
    expect(codes(item(menu).issues)).toEqual(['stale_override'])
    expect(menu.issues).toContainEqual({ code: 'V12', severity: 'warning' })
  })

  it('description: builder copy wins, barsy text only a fallback', () => {
    const builder = oneItemMenu()
      .set(ITEM, 'description', 'barsy', { bg_BG: 'barsy', en_US: 'barsy' })
      .set(ITEM, 'description', 'manual', { en_US: 'Gin, Campari, vermouth' })
    expect(item(run(builder)).fields.description?.value).toEqual({
      bg_BG: 'barsy',
      en_US: 'Gin, Campari, vermouth',
    })
  })

  it('price: locked to barsy on a linked item; a manual price there is ignored and reported', () => {
    const builder = oneItemMenu().set(ITEM, 'price', 'manual', eur(100))
    const negroni = item(run(builder))
    expect(negroni.fields.price).toEqual({ value: eur(1250), provenance: 'locked', layer: 'barsy' })
    expect(negroni.issues).toContainEqual({
      code: 'ignored_value',
      severity: 'warning',
      nodeId: ITEM,
      fieldKey: 'price',
    })
    expect(negroni.computed.orderable).toBe(true)
  })

  it('price: source_first on a display-only (hand-made) item, never orderable', () => {
    const wine = nd('wine')
    const builder = new DocBuilder()
      .section(SECTION)
      .item(wine)
      .set(wine, 'name', 'manual', { bg_BG: 'Вино', en_US: 'Wine' })
      .set(wine, 'price', 'manual', eur(3000))
      .set(wine, 'allergens', 'manual', ['sulphites'])
      .place(wine, SECTION)
    const resolved = item(run(builder), wine)
    expect(resolved.fields.price).toEqual({
      value: eur(3000),
      provenance: 'owned',
      layer: 'manual',
    })
    expect(resolved.visible).toBe(true)
    expect(resolved.computed.orderable).toBe(false)
  })

  it('image: builder-owned', () => {
    const image = { asset_id: testId('as', 'photo'), alt: {}, focal: null }
    const builder = oneItemMenu().set(ITEM, 'image', 'manual', image)
    expect(item(run(builder)).fields.image).toEqual({
      value: image,
      provenance: 'owned',
      layer: 'manual',
    })
  })

  it('allergens: must_agree; a conflict is a V5 warning and does not hide the item (D42)', () => {
    const builder = oneItemMenu().set(ITEM, 'allergens', 'manual', ['sulphites'])
    const negroni = item(run(builder))
    expect(negroni.fields.allergens).toMatchObject({ value: ['sulphites'], conflict: true })
    expect(negroni.issues).toEqual([
      { code: 'V5', severity: 'warning', nodeId: ITEM, fieldKey: 'allergens' },
    ])
    expect(negroni.visible).toBe(true)
    expect(negroni.computed.orderable).toBe(true)
  })

  it('dietary and tags: union; barsy-mapped tags join the set', () => {
    const builder = oneItemMenu()
      .set(ITEM, 'tags', 'barsy', ['house'])
      .set(ITEM, 'tags', 'manual', ['signature'])
    expect(item(run(builder)).fields.tags?.value).toEqual(['signature', 'house'])
  })

  it('portion: barsy-owned with override; stale override reported', () => {
    const builder = oneItemMenu()
      .set(ITEM, 'portion', 'barsy', { value: 100, unit: 'ml' })
      .set(
        ITEM,
        'portion',
        'override',
        { value: 90, unit: 'ml' },
        { basis: { value: 80, unit: 'ml' } },
      )
    const negroni = item(run(builder))
    expect(negroni.fields.portion).toEqual({
      value: { value: 90, unit: 'ml' },
      provenance: 'stale',
      layer: 'override',
    })
    expect(codes(negroni.issues)).toEqual(['stale_override'])
  })

  it('visibility: the builder can hide, never unhide; barsy hiding wins at once', () => {
    const hidden = oneItemMenu().set(ITEM, 'visible', 'manual', false)
    expect(item(run(hidden)).visible).toBe(false)
    const unhide = oneItemMenu()
      .set(ITEM, 'visible', 'barsy', false)
      .set(ITEM, 'visible', 'manual', true)
      .set(ITEM, 'visible', 'override', true, { basis: false })
    const resolved = item(run(unhide))
    expect(resolved.visible).toBe(false)
    expect(resolved.fields.visible).toEqual({ value: false, provenance: 'barsy', layer: 'barsy' })
    expect(resolved.computed.orderable).toBe(false)
  })

  it('for sale: the builder can mark sold out, never back on sale; shown, not orderable (D22)', () => {
    const soldOut = oneItemMenu().set(ITEM, 'for_sale', 'manual', false)
    expect(item(run(soldOut))).toMatchObject({ visible: true, computed: { orderable: false } })
    const backOnSale = oneItemMenu()
      .set(ITEM, 'for_sale', 'barsy', false, { scope: VENUE })
      .set(ITEM, 'for_sale', 'manual', true)
    expect(item(run(backOnSale))).toMatchObject({ visible: true, computed: { orderable: false } })
  })

  it('placement and sort: items in sort-key order within a section', () => {
    const [a, b, c] = [nd('a'), nd('b'), nd('c')]
    const builder = new DocBuilder()
      .section(SECTION)
      .barsyItem(a)
      .barsyItem(b)
      .barsyItem(c)
      .place(a, SECTION, 'a2')
      .place(b, SECTION, 'a0')
      .place(c, SECTION, 'a1')
    expect(run(builder).sections[0]?.itemIds).toEqual([b, c, a])
  })
})

describe('scope and editions', () => {
  it("a venue row beats master for the same layer; another venue's row is ignored", () => {
    const builder = new DocBuilder()
      .section(SECTION)
      .barsyItem(ITEM, 1250)
      .place(ITEM, SECTION)
      .set(ITEM, 'price', 'barsy', eur(999))
      .set(ITEM, 'price', 'barsy', eur(1500), { scope: OTHER_VENUE })
    expect(item(run(builder)).fields.price?.value).toEqual(eur(1250))
    expect(item(run(builder), ITEM).computed.orderable).toBe(true)
  })

  it('the per-venue for-sale flag beats the base flag', () => {
    const builder = oneItemMenu().set(ITEM, 'for_sale', 'barsy', false)
    expect(item(run(builder)).computed.orderable).toBe(true)
    const offHere = oneItemMenu()
      .set(ITEM, 'for_sale', 'barsy', true)
      .set(ITEM, 'for_sale', 'barsy', false, { scope: VENUE })
    expect(item(run(offHere)).computed.orderable).toBe(false)
  })

  it('a master price alone is shown but never makes an item orderable', () => {
    const builder = oneItemMenu().unset(ITEM, 'price').set(ITEM, 'price', 'barsy', eur(1250))
    const negroni = item(run(builder))
    expect(negroni.fields.price?.value).toEqual(eur(1250))
    expect(negroni.computed.orderable).toBe(false)
    expect(codes(negroni.issues)).toContain('price_not_venue_scoped')
  })

  it('a broken venue price never falls back to the master price', () => {
    const builder = oneItemMenu()
      .set(ITEM, 'price', 'barsy', eur(999))
      .set(ITEM, 'price', 'barsy', { amount_minor: 12.5, currency: 'EUR' }, { scope: VENUE })
    const negroni = item(run(builder))
    expect(negroni.fields.price?.value).toBeNull()
    expect(negroni.computed.orderable).toBe(false)
    expect(codes(negroni.issues)).toEqual(expect.arrayContaining(['invalid_value', 'V6']))
  })

  it('rejected rows (valid: false) are never used', () => {
    const builder = oneItemMenu().set(
      ITEM,
      'description',
      'manual',
      { en_US: 'x' },
      { valid: false },
    )
    const negroni = item(run(builder))
    expect(negroni.fields.description?.value).toBeNull()
    expect(codes(negroni.issues)).toEqual(['invalid_value'])
  })

  it('edition layers count only when active; every edition counts when none is named', () => {
    const builder = oneItemMenu().set(ITEM, 'for_sale', 'edition:service:2026-10-08', false)
    expect(item(run(builder, { edition: ['service:2026-10-09'] })).computed.orderable).toBe(true)
    expect(item(run(builder, { edition: ['service:2026-10-08'] })).computed.orderable).toBe(false)
    expect(item(run(builder, { edition: [] })).computed.orderable).toBe(true)
    expect(item(run(builder)).computed.orderable).toBe(false)
  })

  it('an edition hides an item here (hidden at this venue)', () => {
    const builder = oneItemMenu().set(ITEM, 'visible', 'edition:venue:beach', false)
    expect(item(run(builder, { edition: ['venue:beach'] })).visible).toBe(false)
  })
})

describe('source links (rule 6)', () => {
  it.each(['missing', 'deleted'] as const)(
    'a %s barsy link hides the item whatever its status',
    (state) => {
      const builder = oneItemMenu()
      builder.links.splice(0, 1)
      builder.link(ITEM, state)
      const negroni = item(run(builder))
      expect(negroni.visible).toBe(false)
      expect(negroni.computed.orderable).toBe(false)
      expect(negroni.issues).toContainEqual({
        code: state === 'missing' ? 'link_missing' : 'link_deleted',
        severity: 'block_node',
        nodeId: ITEM,
      })
    },
  )

  it('a missing import link hides the node too', () => {
    const builder = oneItemMenu().link(ITEM, 'missing', 'row', 'import:wines')
    expect(item(run(builder)).visible).toBe(false)
  })

  it('a link to something other than an article never makes an item orderable', () => {
    const builder = oneItemMenu()
    builder.links.splice(0, 1)
    builder.link(ITEM, 'active', 'category')
    expect(item(run(builder)).computed.orderable).toBe(false)
  })
})

describe('computed orderable', () => {
  it.each([
    ['hidden status', (b: DocBuilder) => b.status(ITEM, 'hidden')],
    ['no barsy link', (b: DocBuilder) => b.links.splice(0, 1)],
    ['no for-sale flag from barsy', (b: DocBuilder) => b.unset(ITEM, 'for_sale')],
    [
      'a manual for-sale flag only',
      (b: DocBuilder) => b.unset(ITEM, 'for_sale').set(ITEM, 'for_sale', 'manual', true),
    ],
    ['order mode ask_waiter', (b: DocBuilder) => b.set(ITEM, 'order_mode', 'manual', 'ask_waiter')],
    ['order mode hidden', (b: DocBuilder) => b.set(ITEM, 'order_mode', 'manual', 'hidden')],
    ['not placed', (b: DocBuilder) => b.placements.splice(0, 1)],
    ['section hidden', (b: DocBuilder) => b.status(SECTION, 'hidden')],
  ])('is false with %s', (_label, change) => {
    const builder = oneItemMenu()
    change(builder)
    expect(item(run(builder)).computed.orderable).toBe(false)
  })

  it('ask_waiter items stay visible with their price', () => {
    const builder = oneItemMenu().set(ITEM, 'order_mode', 'manual', 'ask_waiter')
    expect(item(run(builder))).toMatchObject({ visible: true, computed: { orderable: false } })
  })

  it('order_mode hidden leaves the item out', () => {
    const builder = oneItemMenu().set(ITEM, 'order_mode', 'manual', 'hidden')
    expect(item(run(builder)).visible).toBe(false)
  })
})

describe('computed priceFrom (required modifier groups)', () => {
  const group = nd('gin')
  const extra = nd('extras')
  function withGroups(min: number, deltas: (number | null)[], optionalDeltas: number[] = []) {
    const builder = oneItemMenu()
      .node(group, 'modifier_group', ITEM)
      .set(group, 'name', 'barsy', { bg_BG: 'Джин', en_US: 'Gin' })
      .set(group, 'min', 'barsy', min)
      .set(group, 'max', 'barsy', Math.max(1, min))
      .node(extra, 'modifier_group', ITEM)
      .set(extra, 'name', 'manual', { bg_BG: 'Екстри', en_US: 'Extras' })
      .set(extra, 'min', 'manual', 0)
      .set(extra, 'max', 'manual', 3)
    deltas.forEach((delta, index) => {
      const option = nd(`opt${index}`)
      builder.node(option, 'option', group).set(option, 'name', 'barsy', { bg_BG: `О${index}` })
      if (delta !== null) builder.set(option, 'price_delta', 'barsy', eur(delta))
    })
    optionalDeltas.forEach((delta, index) => {
      const option = nd(`extra${index}`)
      builder.node(option, 'option', extra).set(option, 'name', 'manual', { bg_BG: `Е${index}` })
      builder.set(option, 'price_delta', 'manual', eur(delta))
    })
    return builder
  }

  it('adds the cheapest choice of each required group', () => {
    const menu = run(withGroups(1, [300, 150, 500], [50]))
    expect(item(menu).computed.priceFrom).toEqual(eur(1400))
    expect(item(menu).modifierGroupIds).toEqual([extra, group].sort())
    expect(menu.modifierGroups[group]).toMatchObject({ required: true, visible: true })
    expect(menu.modifierGroups[extra]).toMatchObject({ required: false })
  })

  it('adds the `min` cheapest choices when a group requires several', () => {
    expect(item(run(withGroups(2, [300, 150, 500]))).computed.priceFrom).toEqual(eur(1700))
  })

  it('is null when the cheapest choice costs nothing (same as the price)', () => {
    expect(item(run(withGroups(1, [null, 200]))).computed.priceFrom).toBeNull()
  })

  it('is null and the item not orderable when a required group cannot be satisfied', () => {
    const menu = run(withGroups(2, [300]))
    expect(item(menu).computed).toMatchObject({ priceFrom: null, orderable: false })
    expect(codes(item(menu).issues)).toContain('required_group_unsatisfiable')
  })

  it('a group whose minimum is unknown counts as required and unsatisfiable', () => {
    const builder = withGroups(0, [300]).unset(group, 'min')
    const menu = run(builder)
    expect(menu.modifierGroups[group]).toMatchObject({ required: true })
    expect(menu.modifierGroups[group]?.issues).toContainEqual({
      code: 'required_missing',
      severity: 'block_node',
      nodeId: group,
      fieldKey: 'min',
    })
    expect(item(menu).computed).toMatchObject({ orderable: false, priceFrom: null })
  })

  it('a group with min above max is blocked, and its item cannot be ordered', () => {
    const builder = withGroups(2, [300, 150, 500])
    builder.unset(group, 'max')
    builder.set(group, 'max', 'barsy', 1)
    const menu = run(builder)
    expect(menu.modifierGroups[group]?.issues).toContainEqual({
      code: 'group_min_max',
      severity: 'block_node',
      nodeId: group,
    })
    expect(item(menu).computed.orderable).toBe(false)
  })
})

describe('computed badges', () => {
  it('`new` for 14 days after the first publish, then dietary labels and tags', () => {
    const builder = oneItemMenu()
      .set(ITEM, 'dietary', 'manual', ['vegan'])
      .set(ITEM, 'tags', 'manual', ['signature', 'vegan'])
    expect(
      item(run(builder, { firstPublishedAt: { [ITEM]: '2026-10-01T12:00:00+03:00' } })).computed
        .badges,
    ).toEqual(['new', 'vegan', 'signature'])
    expect(
      item(run(builder, { firstPublishedAt: { [ITEM]: '2026-09-20T12:00:00+03:00' } })).computed
        .badges,
    ).toEqual(['vegan', 'signature'])
    expect(item(run(builder)).computed.badges).toEqual(['vegan', 'signature'])
  })
})

describe('checks', () => {
  it('V3: an item without a name in the default language is left out', () => {
    const builder = oneItemMenu()
    builder.unset(ITEM, 'name')
    builder.set(ITEM, 'name', 'barsy', { en_US: 'Negroni' })
    const menu = run(builder)
    expect(item(menu).issues).toContainEqual({
      code: 'V3',
      severity: 'block_node',
      nodeId: ITEM,
      fieldKey: 'name',
    })
    expect(item(menu).visible).toBe(false)
    expect(menu.sections[0]?.visible).toBe(false)
    expect(codes(menu.issues)).toEqual(expect.arrayContaining(['V9', 'V10']))
  })

  it('V4: missing allergens are a warning only (D42)', () => {
    const builder = oneItemMenu()
    builder.unset(ITEM, 'allergens')
    const negroni = item(run(builder))
    expect(negroni.issues).toEqual([
      { code: 'V4', severity: 'warning', nodeId: ITEM, fieldKey: 'allergens' },
    ])
    expect(negroni.visible).toBe(true)
  })

  it('V6: a barsy item without a price is left out', () => {
    const builder = oneItemMenu()
    builder.unset(ITEM, 'price')
    const negroni = item(run(builder))
    expect(negroni.issues).toContainEqual({
      code: 'V6',
      severity: 'block_node',
      nodeId: ITEM,
      fieldKey: 'price',
    })
    expect(negroni.visible).toBe(false)
  })

  it('V7: a missing translation in an enabled language is a warning', () => {
    const builder = oneItemMenu().set(ITEM, 'description', 'manual', { bg_BG: 'Описание' })
    const negroni = item(run(builder))
    expect(negroni.issues).toEqual([
      { code: 'V7', severity: 'warning', nodeId: ITEM, fieldKey: 'description', locale: 'en_US' },
    ])
    expect(negroni.visible).toBe(true)
  })

  it('V9 and V10: an empty section is hidden; a menu with no visible item is blocked', () => {
    const menu = run(new DocBuilder().section(SECTION))
    expect(menu.sections[0]).toMatchObject({ visible: false })
    expect(menu.issues).toEqual([
      { code: 'V10', severity: 'block_menu' },
      { code: 'V9', severity: 'warning', nodeId: SECTION },
    ])
  })

  it('reports an item that is in no section', () => {
    const builder = oneItemMenu().barsyItem(nd('loose'))
    expect(item(run(builder), nd('loose')).issues).toEqual([
      { code: 'unplaced_item', severity: 'warning', nodeId: nd('loose') },
    ])
  })

  it('blocks the menu when the inputs do not fit together', () => {
    expect(codes(run(oneItemMenu(), { venueScope: OTHER_VENUE }).issues)).toContain(
      'venue_mismatch',
    )
    expect(codes(run(oneItemMenu(), { locales: [] }).issues)).toContain('no_locales')
    expect(codes(run(oneItemMenu(), { now: 'tonight' }).issues)).toContain('invalid_context')
    expect(codes(run(new DocBuilder(2).section(SECTION)).issues)).toContain('template_mismatch')
    const noRoot = oneItemMenu()
    noRoot.nodes.splice(0, 1)
    const menu = run(noRoot)
    expect(menu.issues).toEqual([{ code: 'missing_root', severity: 'block_menu' }])
    expect(menu.items).toEqual({})
  })
})

describe('structure', () => {
  it('nests sections; a hidden parent hides its children; archived nodes are left out', () => {
    const [bar, gin, archived, inArchived] = [nd('bar'), nd('gin'), nd('old'), nd('older')]
    const builder = new DocBuilder()
      .section(bar)
      .section(gin, bar)
      .section(archived, ROOT, 'archived')
      .section(inArchived, archived)
      .barsyItem(ITEM)
      .place(ITEM, gin)
      .barsyItem(nd('gone'), 900, 'archived')
    const menu = run(builder)
    expect(menu.sections.map((section) => section.id)).toEqual([bar])
    expect(menu.sections[0]?.children.map((section) => section.id)).toEqual([gin])
    expect(menu.sections[0]?.visible).toBe(true)
    expect(Object.keys(menu.items)).toEqual([ITEM])
    expect(menu.issues).toEqual([])

    builder.status(bar, 'hidden')
    const hidden = run(builder)
    expect(hidden.sections[0]?.children[0]?.visible).toBe(false)
    expect(item(hidden).visible).toBe(false)
  })

  it('orders sections, modifier groups and options by their sibling sort key, not their id', () => {
    const [zeta, alpha, mid] = [nd('zeta'), nd('alpha'), nd('mid')]
    const [sub2, sub1] = [nd('sub2'), nd('sub1')]
    const [groupB, groupA] = [nd('groupb'), nd('groupa')]
    const [optionZ, optionA] = [nd('optz'), nd('opta')]
    const builder = new DocBuilder()
      // Keys in code-unit order: 'Zz' < 'a0' < 'a1' (upper case sorts first, as in COLLATE "C").
      .section(alpha, ROOT, 'active', 'a1')
      .section(zeta, ROOT, 'active', 'Zz')
      .section(mid, ROOT, 'active', 'a0')
      .section(sub2, mid, 'active', 'a0')
      .section(sub1, mid, 'active', 'a1')
      .barsyItem(ITEM)
      .place(ITEM, sub1)
      .place(ITEM, sub2)
      .place(ITEM, zeta)
      .place(ITEM, alpha)
      .node(groupA, 'modifier_group', ITEM, 'active', 'a1')
      .node(groupB, 'modifier_group', ITEM, 'active', 'a0')
      .node(optionA, 'option', groupA, 'active', 'b00')
      .node(optionZ, 'option', groupA, 'active', 'a0')
    const menu = run(builder)
    expect(menu.sections.map((section) => section.id)).toEqual([zeta, mid, alpha])
    expect(menu.sections[1]?.children.map((section) => section.id)).toEqual([sub2, sub1])
    expect(item(menu).modifierGroupIds).toEqual([groupB, groupA])
    expect(menu.modifierGroups[groupA]?.optionIds).toEqual([optionZ, optionA])
  })

  it('reports nodes whose parent is missing', () => {
    const builder = oneItemMenu().node(nd('lost'), 'section', nd('nowhere'))
    expect(run(builder).issues).toContainEqual({
      code: 'orphan_node',
      severity: 'warning',
      nodeId: nd('lost'),
    })
  })

  it('the menu root resolves its own fields', () => {
    expect(run(oneItemMenu()).menu).toEqual({
      id: ROOT,
      fields: {
        title: {
          value: { bg_BG: 'Бар', en_US: 'Bar' },
          provenance: 'owned',
          layer: 'manual',
          locales: {
            bg_BG: { provenance: 'owned', layer: 'manual' },
            en_US: { provenance: 'owned', layer: 'manual' },
          },
        },
        intro: { value: null, provenance: 'none', layer: null },
        availability: { value: null, provenance: 'none', layer: null },
      },
      issues: [],
    })
  })
})
