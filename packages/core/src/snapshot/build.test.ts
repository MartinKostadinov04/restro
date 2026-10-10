// buildSnapshot(), the strict schema, the leak guard and the live overlay on hand-made documents
// (brief S3-01a, unit tests). The property tests are in properties.test.ts.
import { describe, expect, it } from 'vitest'

import type { AssetId, TagId } from '../ids'
import { resolve } from '../resolve'
import { CONTEXT, DocBuilder, eur, nd, ROOT, testId, VENUE, VENUE_ID } from '../resolve/fixtures'
import type { ResolveContext } from '../resolve/types'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import {
  ASSET_VARIANT_WIDTHS,
  buildSnapshot,
  DEFAULT_THEME,
  type SnapshotContext,
  snapshotContentHash,
} from './build'
import { SnapshotError } from './errors'
import { assertSnapshotSafe, collectForbiddenValues } from './leak-guard'
import { buildLiveOverlay } from './overlay'
import { LiveOverlaySchema, MenuSnapshotSchema, menuSnapshotJsonSchema } from './schema'

/** A snapshot as plain JSON, for tests that break it on purpose. */
// biome-ignore lint/suspicious/noExplicitAny: the tests reach into JSON they are about to break
type Poke = Record<string, any>

const COCKTAILS = nd('cocktails')
const WINES = nd('wines')
const NEGRONI = nd('negroni')
const SPRITZ = nd('spritz')
const MERLOT = nd('merlot')
const PHOTO = testId('as', 'photo') as AssetId
const SIGNATURE = testId('tg', 'signature') as TagId

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

/** Two sections (wines sorted after cocktails), three items, a manual price on the wine. */
function barMenu(): DocBuilder {
  const builder = new DocBuilder()
    .section(COCKTAILS, ROOT, 'active', 'a0')
    .section(WINES, ROOT, 'active', 'a1')
    .barsyItem(NEGRONI, 1250)
    .barsyItem(SPRITZ, 900)
    .item(MERLOT)
    .place(SPRITZ, COCKTAILS, 'a1')
    .place(NEGRONI, COCKTAILS, 'a0')
    .place(MERLOT, WINES, 'a0')
  builder.set(SPRITZ, 'name', 'barsy', { bg_BG: 'Шприц', en_US: 'Spritz' })
  builder.set(MERLOT, 'name', 'manual', { bg_BG: 'Мерло' })
  builder.set(MERLOT, 'price', 'manual', eur(3200))
  builder.set(MERLOT, 'allergens', 'manual', ['sulphites'])
  builder.set(NEGRONI, 'description', 'manual', { en_US: 'Gin, Campari, vermouth' })
  return builder
}

function snapshotOf(
  builder: DocBuilder,
  ctx = context(),
  resolveContext: ResolveContext = CONTEXT,
) {
  return buildSnapshot(resolve(VENUE_MENU_TEMPLATE, builder.build(), resolveContext), ctx)
}

describe('buildSnapshot', () => {
  it('keeps the resolver order of sections and items, every language, and money in minor units', () => {
    const snapshot = snapshotOf(barMenu())
    expect(snapshot.schema).toBe('menu-snapshot/1')
    expect(snapshot.menu.sections).toEqual([COCKTAILS, WINES])
    expect(snapshot.sections[COCKTAILS]?.items).toEqual([NEGRONI, SPRITZ])
    expect(snapshot.sections[WINES]?.items).toEqual([MERLOT])
    expect(snapshot.items[SPRITZ]?.name).toEqual({ bg_BG: 'Шприц', en_US: 'Spritz' })
    expect(snapshot.items[NEGRONI]?.description).toEqual({ en_US: 'Gin, Campari, vermouth' })
    expect(snapshot.items[NEGRONI]?.price).toEqual({ amount_minor: 1250, currency: 'EUR' })
    expect(snapshot.items[MERLOT]?.price).toEqual({ amount_minor: 3200, currency: 'EUR' })
    expect(snapshot.items[MERLOT]?.allergens).toEqual(['sulphites'])
    expect(snapshot.locales).toEqual({ default: 'bg_BG', available: ['bg_BG', 'en_US'] })
    expect(snapshot.snapshot).toMatchObject({ version: 1, menu_id: ROOT, venue_id: VENUE_ID })
    expect(snapshot.theme).toEqual(DEFAULT_THEME)
  })

  it('carries orderable and order mode: a barsy item is orderable, a hand-made one is not', () => {
    const snapshot = snapshotOf(barMenu())
    expect(snapshot.items[NEGRONI]).toMatchObject({ orderable: true, order_mode: 'orderable' })
    expect(snapshot.items[MERLOT]).toMatchObject({ orderable: false, order_mode: 'orderable' })
    const askWaiter = barMenu()
    askWaiter.set(NEGRONI, 'order_mode', 'manual', 'ask_waiter')
    expect(snapshotOf(askWaiter).items[NEGRONI]).toMatchObject({
      orderable: false,
      order_mode: 'ask_waiter',
    })
  })

  it('leaves out hidden items, groups and options, and sections with nothing left to show', () => {
    const builder = barMenu()
    builder.set(MERLOT, 'visible', 'manual', false)
    builder.set(SPRITZ, 'order_mode', 'manual', 'hidden')
    const group = nd('gin')
    const shown = nd('premium')
    const hidden = nd('house')
    builder.node(group, 'modifier_group', NEGRONI)
    builder.set(group, 'name', 'barsy', { en_US: 'Gin' })
    builder.set(group, 'min', 'barsy', 0)
    builder.set(group, 'max', 'barsy', 1)
    builder.node(shown, 'option', group, 'active', 'a0')
    builder.set(shown, 'name', 'barsy', { en_US: 'Premium gin' })
    builder.set(shown, 'price_delta', 'barsy', eur(300))
    builder.node(hidden, 'option', group, 'hidden', 'a1')
    builder.set(hidden, 'name', 'barsy', { en_US: 'House gin' })
    const snapshot = snapshotOf(builder)
    expect(Object.keys(snapshot.items)).toEqual([NEGRONI])
    expect(snapshot.menu.sections).toEqual([COCKTAILS])
    expect(Object.keys(snapshot.sections)).toEqual([COCKTAILS])
    expect(snapshot.items[NEGRONI]?.modifier_groups).toEqual([group])
    expect(snapshot.modifier_groups[group]).toEqual({
      name: { en_US: 'Gin' },
      min: 0,
      max: 1,
      options: [shown],
    })
    expect(Object.keys(snapshot.options)).toEqual([shown])
    expect(snapshot.options[shown]?.price_delta).toEqual(eur(300))
  })

  it('never carries an internal field, and puts public custom fields in `fields`', () => {
    const builder = barMenu()
    builder.set(NEGRONI, 'internal_note', 'manual', 'Ask Ivo before 23:00 — supplier issue')
    builder.set(NEGRONI, 'abv', 'manual', 24)
    const snapshot = snapshotOf(builder)
    expect(JSON.stringify(snapshot)).not.toContain('supplier issue')
    expect(JSON.stringify(snapshot)).not.toContain('internal_note')
    expect(snapshot.items[NEGRONI]?.fields).toEqual({ abv: 24 })
    expect(snapshot.items[SPRITZ]?.fields).toEqual({})
    expect(snapshot.field_types).toEqual({
      abv: { type: 'number', label: { bg_BG: 'Алкохолно съдържание', en_US: 'ABV' }, unit: '%' },
    })
  })

  it('marks an item that is off sale as sold out and never orderable', () => {
    const builder = barMenu()
    builder.set(NEGRONI, 'for_sale', 'edition:service:2026-10-09', false)
    const snapshot = snapshotOf(builder)
    expect(snapshot.items[NEGRONI]).toMatchObject({
      orderable: false,
      availability: { state: 'sold_out', schedule: null },
    })
    expect(snapshot.items[SPRITZ]?.availability.state).toBe('available')
  })

  it('includes an image only when its variants exist, with the paths S3-01b writes', () => {
    const builder = barMenu()
    const image = { asset_id: PHOTO, alt: { en_US: 'Negroni on ice' }, focal: { x: 0.5, y: 0.4 } }
    builder.set(NEGRONI, 'image', 'manual', image)
    builder.set(SPRITZ, 'image', 'manual', { ...image, alt: {}, focal: null })
    expect(snapshotOf(builder).items[NEGRONI]?.image).toBeNull()
    expect(snapshotOf(builder).assets).toEqual({})

    const withVariants = snapshotOf(
      builder,
      context({ assets: { [PHOTO]: { w: 1600, h: 1200, variants: ASSET_VARIANT_WIDTHS } } }),
    )
    expect(withVariants.items[NEGRONI]?.image).toBe(PHOTO)
    expect(withVariants.items[SPRITZ]?.image).toBe(PHOTO)
    // One entry per asset, with the alt text and focal point of its first use.
    expect(withVariants.assets).toEqual({
      [PHOTO]: {
        w: 1600,
        h: 1200,
        focal: { x: 0.5, y: 0.4 },
        alt: { en_US: 'Negroni on ice' },
        variants: {
          thumb: `/a/${PHOTO}/w320.webp`,
          card: `/a/${PHOTO}/w640.webp`,
          full: `/a/${PHOTO}/w1280.webp`,
        },
      },
    })
  })

  it('keeps only tags of the vocabulary, as tag ids, and keeps only "new" as a badge', () => {
    const builder = barMenu()
    builder.set(NEGRONI, 'tags', 'manual', ['signature', SIGNATURE, 'tg_nope'])
    builder.set(NEGRONI, 'dietary', 'manual', ['vegetarian', 'vegan'])
    const first = { [NEGRONI]: '2026-10-05T12:00:00+03:00' }
    const resolveContext = { ...CONTEXT, firstPublishedAt: first }
    const without = snapshotOf(builder, context(), resolveContext)
    expect(without.items[NEGRONI]).toMatchObject({
      tags: [],
      dietary: ['vegan', 'vegetarian'],
      badges: ['new'],
    })
    expect(without.tags).toEqual({})

    const vocabulary = { [SIGNATURE]: { label: { en_US: 'Signature' } } }
    const withTags = snapshotOf(builder, context({ tagVocabulary: vocabulary }), resolveContext)
    expect(withTags.items[NEGRONI]).toMatchObject({
      tags: [SIGNATURE],
      badges: ['new'],
    })
    expect(withTags.tags).toEqual(vocabulary)
  })

  it('writes the colour token of a tag into the vocabulary, and only a known token', () => {
    const builder = barMenu()
    const colored = {
      [SIGNATURE]: { label: { en_US: 'Signature' }, color: 'accent_text' as const },
    }
    const snapshot = snapshotOf(builder, context({ tagVocabulary: colored }), CONTEXT)
    expect(snapshot.tags).toEqual({
      [SIGNATURE]: { label: { en_US: 'Signature' }, color: 'accent_text' },
    })
    // A raw colour is not a token: the snapshot would not pass its own schema.
    const raw = { [SIGNATURE]: { label: { en_US: 'Signature' }, color: '#ff0000' as never } }
    expect(() => snapshotOf(builder, context({ tagVocabulary: raw }), CONTEXT)).toThrow()
  })

  it('hashes the content without the header', () => {
    const one = snapshotOf(barMenu())
    const other = snapshotOf(
      barMenu(),
      context({
        snapshotId: testId('sn', 'two'),
        version: 7,
        publishedAt: '2026-10-10T01:00:00+03:00',
        edition: ['master', `venue:${VENUE_ID}`, 'service:2026-10-10'],
      }),
    )
    expect(other.snapshot.hash).toBe(one.snapshot.hash)
    expect(other.snapshot.hash).toBe(snapshotContentHash(one))
    expect(one.snapshot.hash).toMatch(/^[0-9a-f]{64}$/)

    const changed = barMenu()
    changed.set(NEGRONI, 'price', 'barsy', eur(1300), { scope: VENUE })
    expect(snapshotOf(changed).snapshot.hash).not.toBe(one.snapshot.hash)
  })

  it('gives the same JSON for the same document', () => {
    expect(JSON.stringify(snapshotOf(barMenu()))).toBe(JSON.stringify(snapshotOf(barMenu())))
  })
})

describe('the strict schema', () => {
  const valid = () => structuredClone(snapshotOf(barMenu())) as unknown as Poke

  it.each([
    ['at the top', (s: Poke) => Object.assign(s, { barsy: 1 })],
    ['in the header', (s: Poke) => Object.assign(s.snapshot, { job_id: 'x' })],
    ['in an item', (s: Poke) => Object.assign(s.items[NEGRONI], { basis: 'x' })],
    ['in a price', (s: Poke) => Object.assign(s.items[NEGRONI].price, { cost: 1 })],
    ['in a section', (s: Poke) => Object.assign(s.sections[WINES], { bid: 7 })],
    ['in the menu', (s: Poke) => Object.assign(s.menu, { root: ROOT })],
    ['in the theme', (s: Poke) => Object.assign(s.theme, { css: 'x' })],
  ])('refuses an extra key %s', (_where, mutate) => {
    const snapshot = valid()
    mutate(snapshot)
    expect(MenuSnapshotSchema.safeParse(snapshot).success).toBe(false)
  })

  it('refuses an id of the wrong kind or a barsy id as a key', () => {
    const wrongKind = valid()
    wrongKind.menu.sections = [testId('as', 'cocktails')]
    expect(MenuSnapshotSchema.safeParse(wrongKind).success).toBe(false)

    const barsyKey = valid()
    barsyKey.items['102751'] = barsyKey.items[NEGRONI]
    expect(MenuSnapshotSchema.safeParse(barsyKey).success).toBe(false)
  })

  it('refuses a node that sits beside the tree (a hidden item smuggled in)', () => {
    const snapshot = valid()
    snapshot.items[nd('hidden')] = snapshot.items[NEGRONI]
    expect(MenuSnapshotSchema.safeParse(snapshot).success).toBe(false)
  })

  it('accepts what the builder makes, and exports as JSON Schema for faces', () => {
    expect(MenuSnapshotSchema.safeParse(valid()).success).toBe(true)
    const jsonSchema = menuSnapshotJsonSchema()
    expect(jsonSchema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(JSON.stringify(jsonSchema)).toContain('menu-snapshot/1')
  })
})

describe('the leak guard', () => {
  it('refuses a forbidden string with its path, never echoing the value', () => {
    const snapshot = structuredClone(snapshotOf(barMenu())) as unknown as Poke
    snapshot.items[NEGRONI].description = { en_US: 'barsy-article-102751' }
    const forbidden = new Map([['barsy-article-102751', 'external_id' as const]])
    let error: unknown
    try {
      assertSnapshotSafe(snapshot, forbidden)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(SnapshotError)
    const refused = error as SnapshotError
    expect(refused.code).toBe('forbidden_value')
    expect(refused.problems).toEqual([
      { path: `items.${NEGRONI}.description.en_US`, code: 'external_id' },
    ])
    expect(refused.message).not.toContain('102751')
  })

  it('redacts a refused key in the path of a malformed snapshot', () => {
    const snapshot = structuredClone(snapshotOf(barMenu())) as unknown as Poke
    snapshot.items.SECRET_102751 = {}
    try {
      assertSnapshotSafe(snapshot, new Map([['SECRET_102751', 'external_id' as const]]))
      expect.unreachable()
    } catch (error) {
      expect((error as SnapshotError).code).toBe('invalid_snapshot')
      expect((error as Error).message).not.toContain('SECRET_102751')
    }
  })

  it('passes a clean snapshot', () => {
    const snapshot = snapshotOf(barMenu())
    expect(assertSnapshotSafe(snapshot, new Map())).toEqual(snapshot)
  })
})

describe('collectForbiddenValues', () => {
  it('refuses external ids, internal values and private override bases, not public text', () => {
    const builder = barMenu()
    builder.set(NEGRONI, 'internal_note', 'manual', 'cost 2.10 per glass')
    // An override of a name: barsy's earlier BG name is private, its EN name is still public.
    builder.set(
      SPRITZ,
      'name',
      'override',
      { bg_BG: 'Апероль Шприц', en_US: 'Spritz' },
      {
        basis: { bg_BG: 'Шприц старо', en_US: 'Spritz' },
      },
    )
    // An override of allergens whose basis is barsy's (public) codes.
    builder.set(NEGRONI, 'allergens', 'override', ['sulphites', 'milk'], { basis: ['sulphites'] })
    const forbidden = collectForbiddenValues({
      template: VENUE_MENU_TEMPLATE,
      doc: builder.build(),
      externalIds: ['102751', '88'],
      backendOnly: ['tenants/tn_x/as_y/original.jpg'],
    })
    expect(Object.fromEntries(forbidden)).toEqual({
      '102751': 'external_id',
      '88': 'external_id',
      'tenants/tn_x/as_y/original.jpg': 'backend_only',
      'cost 2.10 per glass': 'internal_value',
      'Шприц старо': 'override_basis',
    })
    // The snapshot of that document passes the guard built from it.
    const snapshot = snapshotOf(builder)
    expect(() => assertSnapshotSafe(snapshot, forbidden)).not.toThrow()
  })
})

describe('buildLiveOverlay', () => {
  it('marks only items of the current snapshot that the service edition takes off sale', () => {
    const current = snapshotOf(barMenu())
    const tonight = barMenu()
    tonight.set(NEGRONI, 'for_sale', 'edition:service:2026-10-09', false)
    tonight.set(MERLOT, 'for_sale', 'edition:service:2026-10-09', false)
    const added = nd('added')
    tonight.barsyItem(added).place(added, COCKTAILS, 'a2')
    tonight.set(added, 'for_sale', 'edition:service:2026-10-09', false)
    tonight.set(SPRITZ, 'visible', 'manual', false)
    const overlay = buildLiveOverlay(
      resolve(VENUE_MENU_TEMPLATE, tonight.build(), {
        ...CONTEXT,
        edition: ['service:2026-10-09'],
      }),
      current,
    )
    expect(overlay).toEqual({
      version: 1,
      items: { [MERLOT]: { sold_out: true }, [NEGRONI]: { sold_out: true } },
    })
    expect(LiveOverlaySchema.safeParse(overlay).success).toBe(true)
  })
})
