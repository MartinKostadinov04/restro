// Property tests of the snapshot builder (brief S3-01a): no backend-only string ever reaches a
// snapshot (rule 3), our layers never make an item the till hides or takes off sale appear or
// appear orderable (rule 5), and the same document always gives the same snapshot and hash.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import type { Layer, Scope } from '../change-set'
import type { MenuDocument } from '../document/types'
import type { AssetId, NodeId } from '../ids'
import { resolve } from '../resolve'
import {
  CONTEXT,
  DocBuilder,
  nd,
  OTHER_VENUE,
  ROOT,
  testId,
  VENUE,
  VENUE_ID,
} from '../resolve/fixtures'
import type { ResolveContext } from '../resolve/types'
import { sortKeysBetween } from '../sort-keys'
import { ORDER_MODES, VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { ASSET_VARIANT_WIDTHS, buildSnapshot, type SnapshotContext } from './build'
import { assertSnapshotSafe, collectForbiddenValues } from './leak-guard'

const PHOTO = testId('as', 'photo') as AssetId
const OTHER_PHOTO = testId('as', 'other') as AssetId

const CTX: SnapshotContext = {
  template: VENUE_MENU_TEMPLATE,
  snapshotId: testId('sn', 'prop'),
  version: 3,
  publishedAt: '2026-10-09T21:00:00+03:00',
  menuId: ROOT,
  venueId: VENUE_ID,
  edition: ['master', `venue:${VENUE_ID}`],
  locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
  currency: 'EUR',
  assets: { [PHOTO]: { w: 800, h: 600, variants: ASSET_VARIANT_WIDTHS } },
  tagVocabulary: { [testId('tg', 'house')]: { label: { en_US: 'House' } } },
}

// --- value arbitraries: mostly valid values, sometimes anything JSON ----------------------------

const junk = fc.jsonValue({ maxDepth: 2 })
const mostly = <T>(valid: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: valid, weight: 5 }, { arbitrary: junk, weight: 1 })
const money = fc.record({ amount_minor: fc.nat({ max: 100_000 }), currency: fc.constant('EUR') })
const localized = fc.dictionary(
  fc.constantFrom('bg_BG', 'en_US', 'de_DE'),
  fc.string({ minLength: 1, maxLength: 4 }),
)
const image = fc.record({
  asset_id: fc.constantFrom(PHOTO, OTHER_PHOTO),
  alt: localized,
  focal: fc.option(fc.record({ x: fc.constant(0.5), y: fc.constant(0.25) }), { nil: null }),
})
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
  tags: mostly(fc.subarray(['signature', testId('tg', 'house'), testId('tg', 'gone')])),
  abv: mostly(fc.double({ min: 0, max: 100, noNaN: true })),
  portion: mostly(fc.record({ value: fc.integer({ min: 1, max: 500 }), unit: fc.constant('ml') })),
  image: mostly(image),
  hint_color: mostly(fc.constantFrom('#A1B2C3', 'red', '#000000')),
  min: mostly(fc.nat({ max: 2 })),
  max: mostly(fc.integer({ min: 1, max: 3 })),
}
const ITEM_FIELDS = [
  'visible',
  'for_sale',
  'price',
  'order_mode',
  'name',
  'description',
  'allergens',
  'dietary',
  'tags',
  'abv',
  'portion',
  'image',
]
const allLayers = fc.constantFrom<Layer>(
  'till',
  'till',
  'manual',
  'manual',
  'override',
  'edition:service:2026-10-09',
)
const anyScope = fc.constantFrom<Scope>('master', 'master', VENUE, OTHER_VENUE)

const rowFor = (fields: readonly string[], layers: fc.Arbitrary<Layer>) =>
  fc.constantFrom(...fields).chain((fieldKey) =>
    fc.record({
      layer: layers,
      scope: anyScope,
      fieldKey: fc.constant(fieldKey),
      value: VALUES[fieldKey] ?? junk,
      valid: fc.constantFrom(true, true, true, false),
    }),
  )

// --- documents ---------------------------------------------------------------------------------

const SORT_KEYS = sortKeysBetween(null, null, 5)
const sections = [nd('s0'), nd('s1'), nd('s2')]
const items = [nd('i0'), nd('i1'), nd('i2'), nd('i3')]
const groups = [nd('g0'), nd('g1')]
const options = [nd('o0'), nd('o1'), nd('o2')]
const status = fc.constantFrom('active', 'active', 'active', 'hidden', 'archived' as const)

const documentArbitrary = fc.record({
  sectionParents: fc.tuple(...sections.map((_, index) => fc.nat({ max: index }))),
  sectionStatus: fc.tuple(...sections.map(() => status)),
  sectionKeys: fc.tuple(...sections.map(() => fc.constantFrom(...SORT_KEYS))),
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
    { maxLength: 8 },
  ),
  groupItems: fc.tuple(...groups.map(() => fc.constantFrom(...items))),
  optionGroups: fc.tuple(...options.map(() => fc.constantFrom(...groups))),
  itemRows: fc.array(
    fc.record({ node: fc.constantFrom(...items), row: rowFor(ITEM_FIELDS, allLayers) }),
    { maxLength: 40 },
  ),
  sectionRows: fc.array(
    fc.record({
      node: fc.constantFrom(...sections),
      row: rowFor(['title', 'description', 'image', 'hint_color'], allLayers),
    }),
    { maxLength: 8 },
  ),
  groupRows: fc.array(
    fc.record({ node: fc.constantFrom(...groups), row: rowFor(['name', 'min', 'max'], allLayers) }),
    { maxLength: 8 },
  ),
  optionRows: fc.array(
    fc.record({
      node: fc.constantFrom(...options),
      row: rowFor(['name', 'price_delta'], allLayers),
    }),
    { maxLength: 8 },
  ),
  firstPublished: fc.subarray(items),
  seed: fc.integer(),
})

type Spec = typeof documentArbitrary extends fc.Arbitrary<infer T> ? T : never

/** A document whose nodes all have the basics, so that many of them resolve visible. */
function buildDocument(spec: Spec): DocBuilder {
  const builder = new DocBuilder()
  sections.forEach((id, index) => {
    const parentIndex = spec.sectionParents[index] ?? 0
    const parent = parentIndex === index ? ROOT : (sections[parentIndex] ?? ROOT)
    builder.section(id, parent, spec.sectionStatus[index] ?? 'active', spec.sectionKeys[index])
  })
  items.forEach((id, index) => {
    builder.item(id, spec.itemStatus[index] ?? 'active')
    builder.set(id, 'name', 'manual', { bg_BG: `Име ${index}`, en_US: `Name ${index}` })
    builder.set(id, 'price', 'manual', { amount_minor: 100 * (index + 1), currency: 'EUR' })
    const link = spec.itemLinks[index] ?? 'none'
    if (link !== 'none') {
      builder.link(id, link)
      builder.set(id, 'price', 'till', { amount_minor: 990, currency: 'EUR' }, { scope: VENUE })
      builder.set(id, 'for_sale', 'till', true, { scope: VENUE })
    }
  })
  for (const placement of spec.placements) {
    builder.place(placement.item, placement.section, placement.key)
  }
  groups.forEach((id, index) => {
    builder.node(id, 'modifier_group', spec.groupItems[index] ?? (items[0] as NodeId))
    builder.set(id, 'name', 'manual', { en_US: `Group ${index}` })
    builder.set(id, 'min', 'manual', 0)
    builder.set(id, 'max', 'manual', 1)
  })
  options.forEach((id, index) => {
    builder.node(id, 'option', spec.optionGroups[index] ?? (groups[0] as NodeId))
    builder.set(id, 'name', 'manual', { en_US: `Option ${index}` })
  })
  for (const { node, row } of [
    ...spec.itemRows,
    ...spec.sectionRows,
    ...spec.groupRows,
    ...spec.optionRows,
  ]) {
    builder.set(node, row.fieldKey, row.layer, row.value, {
      scope: row.scope,
      valid: row.valid,
      basis: row.layer === 'override' ? row.value : undefined,
    })
  }
  return builder
}

function contextFor(spec: Spec): ResolveContext {
  return {
    ...CONTEXT,
    edition: [`venue:${VENUE_ID}`],
    firstPublishedAt: Object.fromEntries(
      spec.firstPublished.map((id) => [id, '2026-10-05T12:00:00+03:00']),
    ),
  }
}

function snapshotOf(doc: MenuDocument, spec: Spec) {
  return buildSnapshot(resolve(VENUE_MENU_TEMPLATE, doc, contextFor(spec)), CTX)
}

// --- rule 3 ------------------------------------------------------------------------------------

describe('rule 3: nothing backend-only ever reaches a snapshot', () => {
  it('external ids, internal field values and override bases never appear', () => {
    let counter = 0
    const sentinel = (kind: string) => {
      counter += 1
      return `SNTL${kind}${counter}x`
    }
    fc.assert(
      fc.property(
        documentArbitrary,
        // One override per slot: a second one would replace the first (and its basis).
        fc.uniqueArray(
          fc.record({
            node: fc.constantFrom(...items),
            field: fc.constantFrom('name', 'description', 'tags', 'allergens'),
          }),
          { maxLength: 6, selector: (override) => `${override.node}:${override.field}` },
        ),
        (spec, overrides) => {
          const builder = buildDocument(spec)
          const sentinels: string[] = []
          const mark = (kind: string) => {
            const value = sentinel(kind)
            sentinels.push(value)
            return value
          }
          // Internal values on every item, and a field the template does not know.
          for (const id of items) {
            builder.set(id, 'internal_note', 'manual', mark('note'))
            builder.set(id, 'secret_cost', 'manual', { amount: mark('cost') })
          }
          // Overrides whose bases (the till's earlier values) are sentinels.
          for (const { node, field } of overrides) {
            const basis =
              field === 'tags' || field === 'allergens'
                ? [mark('basis')]
                : { bg_BG: mark('basis'), en_US: mark('basis') }
            const value =
              field === 'tags' ? ['signature'] : field === 'allergens' ? ['milk'] : { en_US: 'Ok' }
            builder.set(node, field, 'override', value, { basis })
          }
          const externalIds = items.map(() => mark('ext'))
          const doc = builder.build()
          const snapshot = snapshotOf(doc, spec)
          const json = JSON.stringify(snapshot)
          for (const value of sentinels) expect(json).not.toContain(value)
          const forbidden = collectForbiddenValues({
            template: VENUE_MENU_TEMPLATE,
            doc,
            externalIds,
          })
          for (const value of sentinels) expect(forbidden.has(value)).toBe(true)
          expect(() => assertSnapshotSafe(snapshot, forbidden)).not.toThrow()
        },
      ),
      { numRuns: 200 },
    )
  })
})

// --- rule 5 ------------------------------------------------------------------------------------

const ITEM = nd('negroni')
const SECTION = nd('cocktails')
const mostlyTrue = fc.constantFrom(true, true, true, false)
const maybe = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined, freq: 4 })
const tillFlags = fc.record({
  visibleMaster: maybe(mostlyTrue),
  visibleVenue: maybe(mostlyTrue),
  forSaleMaster: maybe(mostlyTrue),
  forSaleVenue: maybe(mostlyTrue),
})
const builderLayer = fc.constantFrom<Layer>('manual', 'override', 'edition:service:2026-10-09')

describe('rule 5: our layers never make the snapshot less cautious than the till', () => {
  it('an item the till hides is never in the snapshot; one it takes off sale is never orderable', () => {
    fc.assert(
      fc.property(
        tillFlags,
        fc.array(rowFor(ITEM_FIELDS, builderLayer), { maxLength: 12 }),
        (flags, rows) => {
          const hidden = (flags.visibleVenue ?? flags.visibleMaster) === false
          const offSale = (flags.forSaleVenue ?? flags.forSaleMaster) === false
          fc.pre(hidden || offSale)
          const builder = new DocBuilder().section(SECTION).tillItem(ITEM).place(ITEM, SECTION)
          builder.unset(ITEM, 'visible').unset(ITEM, 'for_sale')
          const tillRows: [string, boolean | undefined, Scope][] = [
            ['visible', flags.visibleMaster, 'master'],
            ['visible', flags.visibleVenue, VENUE],
            ['for_sale', flags.forSaleMaster, 'master'],
            ['for_sale', flags.forSaleVenue, VENUE],
          ]
          for (const [field, value, scope] of tillRows) {
            if (value !== undefined) builder.set(ITEM, field, 'till', value, { scope })
          }
          for (const row of rows) {
            builder.set(ITEM, row.fieldKey, row.layer, row.value, {
              scope: row.scope,
              valid: row.valid,
              basis: row.layer === 'override' ? row.value : undefined,
            })
          }
          const snapshot = buildSnapshot(
            resolve(VENUE_MENU_TEMPLATE, builder.build(), { ...CONTEXT, edition: undefined }),
            CTX,
          )
          const item = snapshot.items[ITEM]
          if (hidden) expect(item).toBeUndefined()
          if (item !== undefined) {
            expect(item.orderable).toBe(false)
            if (offSale) expect(item.availability.state).toBe('sold_out')
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

// --- determinism -------------------------------------------------------------------------------

/** A seeded shuffle (mulberry32), so a failing case can be replayed. */
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

describe('determinism', () => {
  it('the same document gives the same hash, and shuffled input arrays the same snapshot', () => {
    fc.assert(
      fc.property(documentArbitrary, (spec) => {
        const doc = buildDocument(spec).build()
        const first = snapshotOf(doc, spec)
        expect(snapshotOf(buildDocument(spec).build(), spec).snapshot.hash).toBe(
          first.snapshot.hash,
        )
        const shuffledDoc: MenuDocument = {
          menu: doc.menu,
          nodes: shuffled(doc.nodes, spec.seed),
          placements: shuffled(doc.placements, spec.seed + 1),
          values: shuffled(doc.values, spec.seed + 2),
          links: shuffled(doc.links, spec.seed + 3),
        }
        expect(JSON.stringify(snapshotOf(shuffledDoc, spec))).toBe(JSON.stringify(first))
      }),
      { numRuns: 200 },
    )
  })

  it('many generated documents produce visible items (the properties are not vacuous)', () => {
    let withItems = 0
    fc.assert(
      fc.property(documentArbitrary, (spec) => {
        if (Object.keys(snapshotOf(buildDocument(spec).build(), spec).items).length > 0) {
          withItems += 1
        }
      }),
      { numRuns: 200, seed: 20261010 },
    )
    expect(withItems).toBeGreaterThan(50)
  })
})
