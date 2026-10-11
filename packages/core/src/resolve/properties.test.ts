import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import type { Layer, Scope } from '../change-set'
import type { MenuDocument } from '../document/types'
import type { NodeId } from '../ids'
import { LOCALES, type Locale } from '../locales'
import { sortKeysBetween } from '../sort-keys'
import { ORDER_MODES, VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { CONTEXT, DocBuilder, nd, OTHER_VENUE, ROOT, VENUE } from './fixtures'
import { resolve } from './resolve'
import type { ResolveContext } from './types'

const ITEM = nd('negroni')
const SECTION = nd('cocktails')

/** The till's layer: whichever connector feeds the venue's till writes it (brief CF-03). */
const TILL = 'till' as const satisfies Layer

// --- value arbitraries: mostly valid values of each field, sometimes anything JSON ---------------

const junk = fc.jsonValue({ maxDepth: 2 })
const mostly = <T>(valid: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: valid, weight: 4 }, { arbitrary: junk, weight: 1 })
const money = fc.record({
  amount_minor: fc.nat({ max: 100_000 }),
  currency: fc.constant('EUR'),
})
const localized = fc.dictionary(
  fc.constantFrom<Locale>('bg_BG', 'en_US', 'de_DE'),
  fc.string({ minLength: 1, maxLength: 4 }),
)
const VALUES: Record<string, fc.Arbitrary<unknown>> = {
  visible: mostly(fc.boolean()),
  for_sale: mostly(fc.boolean()),
  price: mostly(money),
  price_delta: mostly(money),
  order_mode: mostly(fc.constantFrom(...ORDER_MODES)),
  name: mostly(localized),
  title: mostly(localized),
  description: mostly(localized),
  allergens: mostly(fc.subarray([...ALLERGENS])),
  dietary: mostly(fc.subarray([...DIETARY_LABELS])),
  tags: mostly(fc.subarray(['signature', 'house', 'new'])),
  min: mostly(fc.nat({ max: 3 })),
  max: mostly(fc.integer({ min: 1, max: 3 })),
}
const ITEM_FIELDS = [
  'visible',
  'for_sale',
  'price',
  'order_mode',
  'name',
  'allergens',
  'dietary',
  'tags',
  'description',
]

const builderLayer = fc.constantFrom<Layer>(
  'manual',
  'override',
  'edition:tonight',
  'edition:venue:beach',
)
const anyScope = fc.constantFrom<Scope>('master', VENUE, OTHER_VENUE)

interface RowSpec {
  layer: Layer
  scope: Scope
  fieldKey: string
  value: unknown
  basis: unknown
  valid: boolean
}

function rowsFor(fields: readonly string[], layers: fc.Arbitrary<Layer>) {
  return fc.constantFrom(...fields).chain((fieldKey) =>
    fc.record({
      layer: layers,
      scope: anyScope,
      fieldKey: fc.constant(fieldKey),
      value: VALUES[fieldKey] ?? junk,
      basis: fc.option(VALUES[fieldKey] ?? junk, { nil: null }),
      valid: fc.boolean(),
    }),
  )
}

function addRows(builder: DocBuilder, nodeId: NodeId, rows: readonly RowSpec[]): void {
  for (const row of rows) {
    builder.set(nodeId, row.fieldKey, row.layer, row.value, {
      scope: row.scope,
      basis: row.basis,
      valid: row.valid,
    })
  }
}

const editionContext = fc.option(fc.subarray(['tonight', 'venue:beach']), { nil: undefined })

function contextWith(edition: string[] | undefined): ResolveContext {
  return edition === undefined ? CONTEXT : { ...CONTEXT, edition }
}

// --- the base rows of the one item: the till's, or the manager's in a venue with no till -------

// Biased towards an orderable item (true flags, a valid venue price, an active link), so the price
// property meets many orderable items; every combination still occurs.
const mostlyTrue = fc.constantFrom(true, true, true, false)
const maybe = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined, freq: 4 })
const baseFlags = fc.record({
  visibleMaster: maybe(mostlyTrue),
  visibleVenue: maybe(mostlyTrue),
  forSaleMaster: maybe(mostlyTrue),
  forSaleVenue: maybe(mostlyTrue),
  priceVenue: maybe(mostly(money)),
  priceVenueValid: mostlyTrue,
  priceMaster: maybe(money),
  orderMode: maybe(fc.constantFrom(...ORDER_MODES)),
  linkState: fc.constantFrom('active', 'active', 'active', 'missing', 'deleted' as const),
})

type BaseFlags = typeof baseFlags extends fc.Arbitrary<infer T> ? T : never

/** The base's own value of a flag at this venue: the venue row, else the master row. */
function baseSays(venue: boolean | undefined, master: boolean | undefined): boolean | undefined {
  return venue ?? master
}

/** One venue shape rule 5 is checked on. */
interface VenueShape {
  readonly name: string
  /** True when the item is linked to the venue's till: only then may it ever be orderable. */
  readonly tillLinked: boolean
  /** The menu with the base's rows for the one item and the builder rows `rows` on top. */
  readonly menu: (flags: BaseFlags, rows: readonly RowSpec[]) => DocBuilder
}

/** A venue with a till: the item is linked, and the till's rows are its base. */
function tillLinkedMenu(flags: BaseFlags, rows: readonly RowSpec[]): DocBuilder {
  const builder = new DocBuilder().section(SECTION).item(ITEM).place(ITEM, SECTION)
  builder.link(ITEM, flags.linkState)
  builder.set(ITEM, 'name', TILL, { bg_BG: 'Негрони', en_US: 'Negroni' })
  builder.set(ITEM, 'allergens', TILL, [])
  const optional: [string, unknown, Scope, boolean][] = [
    ['visible', flags.visibleMaster, 'master', true],
    ['visible', flags.visibleVenue, VENUE, true],
    ['for_sale', flags.forSaleMaster, 'master', true],
    ['for_sale', flags.forSaleVenue, VENUE, true],
    ['price', flags.priceVenue, VENUE, flags.priceVenueValid],
    ['price', flags.priceMaster, 'master', true],
  ]
  for (const [fieldKey, value, scope, valid] of optional) {
    if (value !== undefined) builder.set(ITEM, fieldKey, TILL, value, { scope, valid })
  }
  if (flags.orderMode !== undefined) builder.set(ITEM, 'order_mode', 'manual', flags.orderMode)
  addRows(builder, ITEM, rows)
  return builder
}

/**
 * A venue with no till (D64): a hand-made item, its name, price and flags in the manual layer. A
 * builder layer may only say false to a flag (`validateWrite`), so the base's `true` is no row at
 * all. The base rows go in after the builder rows, so they keep their slots. Without a till the
 * manual layer is the base itself, so the builder rows are the ones the database can hold: only
 * the till layer is ever venue-scoped (check `field_values_venue_scope_till_only`), and a venue
 * row of the manual layer would otherwise stand in for the base's own master row.
 */
function noTillMenu(flags: BaseFlags, rows: readonly RowSpec[]): DocBuilder {
  const builder = new DocBuilder().section(SECTION).item(ITEM).place(ITEM, SECTION)
  addRows(
    builder,
    ITEM,
    rows.filter((row) => row.scope === 'master'),
  )
  builder.set(ITEM, 'name', 'manual', { bg_BG: 'Негрони', en_US: 'Negroni' })
  builder.set(ITEM, 'allergens', 'manual', [])
  if (baseSays(flags.visibleVenue, flags.visibleMaster) === false) {
    builder.set(ITEM, 'visible', 'manual', false)
  }
  if (baseSays(flags.forSaleVenue, flags.forSaleMaster) === false) {
    builder.set(ITEM, 'for_sale', 'manual', false)
  }
  const price = flags.priceVenue ?? flags.priceMaster
  if (price !== undefined) {
    builder.set(ITEM, 'price', 'manual', price, { valid: flags.priceVenueValid })
  }
  if (flags.orderMode !== undefined) builder.set(ITEM, 'order_mode', 'manual', flags.orderMode)
  return builder
}

const VENUE_SHAPES: readonly VenueShape[] = [
  { name: 'a till-linked menu', tillLinked: true, menu: tillLinkedMenu },
  { name: 'a no-till (manual-only) menu', tillLinked: false, menu: noTillMenu },
]

describe.each(VENUE_SHAPES)('rule 5 on $name: our layers never undo the base', (shape) => {
  it('an item its base hides or takes off sale is never visible and orderable', () => {
    fc.assert(
      fc.property(
        baseFlags,
        fc.array(rowsFor(ITEM_FIELDS, builderLayer), { maxLength: 12 }),
        editionContext,
        (flags, rows, edition) => {
          const hidden = baseSays(flags.visibleVenue, flags.visibleMaster) === false
          const offSale = baseSays(flags.forSaleVenue, flags.forSaleMaster) === false
          fc.pre(hidden || offSale)
          const builder = shape.menu(flags, rows)
          const menu = resolve(VENUE_MENU_TEMPLATE, builder.build(), contextWith(edition))
          const item = menu.items[ITEM]
          expect(item?.computed.orderable).toBe(false)
          if (hidden) expect(item?.visible).toBe(false)
        },
      ),
    )
  })

  /** Checks the price rule on one document; returns whether the item was orderable. */
  function priceIsTills(doc: MenuDocument, edition: string[] | undefined): boolean {
    const item = resolve(VENUE_MENU_TEMPLATE, doc, contextWith(edition)).items[ITEM]
    if (item?.computed.orderable !== true) return false
    // Nothing is orderable without a till link.
    expect(shape.tillLinked).toBe(true)
    const tillPrice = doc.values.find(
      (row) =>
        row.nodeId === ITEM &&
        row.fieldKey === 'price' &&
        row.layer === TILL &&
        row.scope === VENUE,
    )
    expect(tillPrice?.valid).toBe(true)
    expect(item.fields.price?.value).toEqual(tillPrice?.value)
    return true
  }

  it("an orderable item's price is always the till's price for this venue", () => {
    fc.assert(
      fc.property(
        baseFlags,
        fc.array(rowsFor(ITEM_FIELDS, builderLayer), { maxLength: 6 }),
        editionContext,
        (flags, rows, edition) => {
          priceIsTills(shape.menu(flags, rows).build(), edition)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('… also when every builder layer tries to set a price on an orderable item', () => {
    let orderableRuns = 0
    const runs = 300
    fc.assert(
      fc.property(
        money,
        fc.option(money, { nil: undefined }),
        fc.array(rowsFor(['price', 'price', 'order_mode', 'name'], builderLayer), {
          maxLength: 6,
        }),
        editionContext,
        (venuePrice, masterPrice, rows, edition) => {
          const builder = shape.menu(
            {
              visibleMaster: true,
              visibleVenue: undefined,
              forSaleMaster: undefined,
              forSaleVenue: true,
              priceVenue: venuePrice,
              priceVenueValid: true,
              priceMaster: masterPrice,
              orderMode: undefined,
              linkState: 'active',
            },
            rows,
          )
          if (priceIsTills(builder.build(), edition)) orderableRuns += 1
        },
      ),
      // A fixed seed, so the coverage count below cannot flake.
      { numRuns: runs, seed: 20261009 },
    )
    if (shape.tillLinked) {
      // The rule only bites on orderable items: the runs must have met plenty of them.
      expect(orderableRuns).toBeGreaterThan(runs / 4)
    } else {
      // Without a till nothing is orderable, whatever the builder layers say (D12 not built).
      expect(orderableRuns).toBe(0)
    }
  })
})

// --- determinism ----------------------------------------------------------------------------------

/** A small seeded generator (mulberry32), so a shuffle is reproducible from its seed. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = copy[i] as T
    copy[i] = copy[j] as T
    copy[j] = a
  }
  return copy
}

const SORT_KEYS = sortKeysBetween(null, null, 6)
const sections = [nd('s0'), nd('s1'), nd('s2'), nd('s3')]
const items = [nd('i0'), nd('i1'), nd('i2'), nd('i3'), nd('i4')]
const groups = [nd('g0'), nd('g1')]
const options = [nd('o0'), nd('o1'), nd('o2')]
const allLayers = fc.constantFrom<Layer>(TILL, TILL, 'manual', 'override', 'edition:tonight')
const status = fc.constantFrom('active', 'active', 'active', 'hidden', 'archived' as const)

const documentArbitrary = fc.record({
  sectionParents: fc.tuple(...sections.map((_, index) => fc.nat({ max: index }))),
  sectionStatus: fc.tuple(...sections.map(() => status)),
  itemStatus: fc.tuple(...items.map(() => status)),
  itemLinks: fc.tuple(
    ...items.map(() => fc.constantFrom('none', 'active', 'active', 'missing', 'deleted' as const)),
  ),
  placements: fc.array(
    fc.record({
      item: fc.constantFrom(...items),
      section: fc.constantFrom(...sections),
      key: fc.constantFrom(...SORT_KEYS),
    }),
    { maxLength: 10 },
  ),
  groupItems: fc.tuple(...groups.map(() => fc.constantFrom(...items))),
  optionGroups: fc.tuple(...options.map(() => fc.constantFrom(...groups))),
  itemRows: fc.array(
    fc.record({ node: fc.constantFrom(...items), row: rowsFor(ITEM_FIELDS, allLayers) }),
    { maxLength: 40 },
  ),
  sectionRows: fc.array(
    fc.record({
      node: fc.constantFrom(...sections),
      row: rowsFor(['title', 'description'], allLayers),
    }),
    { maxLength: 8 },
  ),
  groupRows: fc.array(
    fc.record({
      node: fc.constantFrom(...groups),
      row: rowsFor(['name', 'min', 'max'], allLayers),
    }),
    { maxLength: 8 },
  ),
  optionRows: fc.array(
    fc.record({
      node: fc.constantFrom(...options),
      row: rowsFor(['name', 'price_delta'], allLayers),
    }),
    { maxLength: 8 },
  ),
  duplicates: fc.nat({ max: 3 }),
  locales: fc.subarray([...LOCALES.slice(0, 3)], { minLength: 1 }),
  edition: editionContext,
  seed: fc.integer(),
})

type Generated = typeof documentArbitrary extends fc.Arbitrary<infer T> ? T : never

function buildDocument(spec: Generated): MenuDocument {
  const builder = new DocBuilder()
  sections.forEach((id, index) => {
    const parentIndex = spec.sectionParents[index] ?? 0
    const parent = parentIndex === index ? ROOT : (sections[parentIndex] ?? ROOT)
    builder.section(id, parent, spec.sectionStatus[index] ?? 'active')
  })
  items.forEach((id, index) => {
    builder.item(id, spec.itemStatus[index] ?? 'active')
    const link = spec.itemLinks[index] ?? 'none'
    if (link !== 'none') builder.link(id, link)
  })
  for (const placement of spec.placements) {
    builder.place(placement.item, placement.section, placement.key)
  }
  groups.forEach((id, index) => {
    builder.node(id, 'modifier_group', spec.groupItems[index] ?? (items[0] as NodeId))
  })
  options.forEach((id, index) => {
    builder.node(id, 'option', spec.optionGroups[index] ?? (groups[0] as NodeId))
  })
  for (const { node, row } of [
    ...spec.itemRows,
    ...spec.sectionRows,
    ...spec.groupRows,
    ...spec.optionRows,
  ]) {
    addRows(builder, node, [row])
  }
  // Rows sharing a slot cannot exist in the database; the choice must still not depend on order.
  builder.values.push(
    ...builder.values.slice(0, spec.duplicates).map((row) => ({ ...row, valid: !row.valid })),
  )
  return builder.build()
}

function shuffleDocument(doc: MenuDocument, seed: number): MenuDocument {
  return {
    menu: doc.menu,
    nodes: shuffled(doc.nodes, seed),
    placements: shuffled(doc.placements, seed + 1),
    values: shuffled(doc.values, seed + 2),
    links: shuffled(doc.links, seed + 3),
  }
}

describe('determinism', () => {
  it('the same input always gives the same output, whatever the order of the input arrays', () => {
    fc.assert(
      fc.property(documentArbitrary, (spec) => {
        const doc = buildDocument(spec)
        const context: ResolveContext = {
          ...contextWith(spec.edition),
          locales: spec.locales,
        }
        const first = resolve(VENUE_MENU_TEMPLATE, doc, context)
        const again = resolve(VENUE_MENU_TEMPLATE, shuffleDocument(doc, spec.seed), context)
        expect(again).toStrictEqual(first)
        expect(JSON.stringify(again)).toBe(JSON.stringify(first))
      }),
      { numRuns: 200 },
    )
  })

  it('never mutates its input', () => {
    fc.assert(
      fc.property(documentArbitrary, (spec) => {
        const doc = buildDocument(spec)
        // JSON, not structuredClone: fast-check builds null-prototype objects, which a clone
        // would turn into plain ones and `toStrictEqual` would report as a difference.
        const before = JSON.stringify(doc)
        resolve(VENUE_MENU_TEMPLATE, doc, CONTEXT)
        expect(JSON.stringify(doc)).toBe(before)
      }),
      { numRuns: 50 },
    )
  })
})
