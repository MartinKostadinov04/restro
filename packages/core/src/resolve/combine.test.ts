import { describe, expect, it } from 'vitest'

import type { Layer, Scope } from '../change-set'
import type { FieldDefinition } from '../field-definition'
import type { NodeType } from '../node-types'
import { findField } from '../template'
import { VENUE_MENU_TEMPLATE } from '../templates/venue-menu'
import { combineField, type FieldInput, readsLayer } from './combine'
import { eur, VENUE } from './fixtures'
import type { LayerValue } from './layers'

function def(nodeType: NodeType, key: string, patch: Partial<FieldDefinition> = {}) {
  const found = findField(VENUE_MENU_TEMPLATE, nodeType, key)
  if (found === undefined) throw new Error(`no ${nodeType}.${key}`)
  return { ...found, ...patch } as FieldDefinition
}

interface Given {
  value: unknown
  basis?: unknown
  scope?: Scope
  observedAt?: string
}

function input(
  definition: FieldDefinition,
  layers: Partial<Record<Layer, Given>>,
  linkedToTill = true,
): FieldInput {
  const map = new Map<Layer, LayerValue>()
  for (const [layer, given] of Object.entries(layers) as [Layer, Given][]) {
    map.set(layer, {
      layer,
      scope: given.scope ?? 'master',
      value: given.value,
      basis: given.basis ?? null,
      observedAt: given.observedAt ?? '2026-10-01T10:00:00+03:00',
    })
  }
  return { definition, layers: map, linkedToTill, locales: ['bg_BG', 'en_US'] }
}

const portion = def('item', 'portion')
const description = def('item', 'description')
const name = def('item', 'name')
const price = def('item', 'price')
const visible = def('item', 'visible')
const forSale = def('item', 'for_sale')
const allergens = def('item', 'allergens')
const dietary = def('item', 'dietary')
const tags = def('item', 'tags')
const orderMode = def('item', 'order_mode')

const ml = (value: number) => ({ value, unit: 'ml' })

describe('source_first (till-owned: name, portion)', () => {
  it('takes override, then till, then manual', () => {
    const all = { value: ml(10), basis: ml(20) }
    expect(
      combineField(
        input(portion, {
          override: all,
          till: { value: ml(20) },
          manual: { value: ml(30) },
        }),
      ).field,
    ).toEqual({ value: ml(10), provenance: 'overridden', layer: 'override' })
    expect(
      combineField(
        input(portion, {
          till: { value: ml(20) },
          manual: { value: ml(30) },
        }),
      ).field,
    ).toEqual({ value: ml(20), provenance: 'till', layer: 'till' })
    expect(combineField(input(portion, { manual: { value: ml(30) } })).field).toEqual({
      value: ml(30),
      provenance: 'owned',
      layer: 'manual',
    })
  })

  it('falls back to the definition default, else to no value', () => {
    expect(combineField(input(portion, {})).field).toEqual({
      value: null,
      provenance: 'none',
      layer: null,
    })
    const withDefault = def('item', 'portion', { default: ml(50) })
    expect(combineField(input(withDefault, {})).field).toEqual({
      value: ml(50),
      provenance: 'none',
      layer: 'default',
    })
  })

  it('skips empty values (first non-empty)', () => {
    const note = def('item', 'name', { key: 'subtitle' })
    const outcome = combineField(
      input(note, {
        override: { value: { bg_BG: '  ' }, basis: {} },
        manual: { value: { bg_BG: 'Б' } },
      }),
    )
    expect(outcome.field.value).toEqual({ bg_BG: 'Б' })
    expect(outcome.field.provenance).toBe('owned')
  })
})

describe('overrides and staleness', () => {
  it('an override whose basis equals till is in force and fresh', () => {
    const outcome = combineField(
      input(portion, { override: { value: ml(10), basis: ml(20) }, till: { value: ml(20) } }),
    )
    expect(outcome.field.provenance).toBe('overridden')
    expect(outcome.issues).toEqual([])
  })

  it('review (default): a stale override stays in force, marked stale, with an issue', () => {
    const outcome = combineField(
      input(portion, { override: { value: ml(10), basis: ml(20) }, till: { value: ml(25) } }),
    )
    expect(outcome.field).toEqual({ value: ml(10), provenance: 'stale', layer: 'override' })
    expect(outcome.issues).toEqual([{ code: 'stale_override', severity: 'warning' }])
  })

  it('keep: stays in force and marked stale, without an issue', () => {
    const keep = def('item', 'portion', { stalePolicy: 'keep' })
    const outcome = combineField(
      input(keep, { override: { value: ml(10), basis: ml(20) }, till: { value: ml(25) } }),
    )
    expect(outcome.field.provenance).toBe('stale')
    expect(outcome.issues).toEqual([])
  })

  it("drop: till's new value takes over", () => {
    const drop = def('item', 'portion', { stalePolicy: 'drop' })
    const outcome = combineField(
      input(drop, { override: { value: ml(10), basis: ml(20) }, till: { value: ml(25) } }),
    )
    expect(outcome.field).toEqual({ value: ml(25), provenance: 'till', layer: 'till' })
    expect(outcome.issues).toEqual([])
  })

  it('is stale when till no longer holds a value or the basis is unknown', () => {
    expect(
      combineField(input(portion, { override: { value: ml(10), basis: ml(20) } })).field.provenance,
    ).toBe('stale')
    expect(
      combineField(input(portion, { override: { value: ml(10) }, till: { value: ml(20) } })).field
        .provenance,
    ).toBe('stale')
  })

  it('compares sets regardless of order', () => {
    const outcome = combineField(
      input(allergens, {
        override: { value: ['milk'], basis: ['gluten', 'milk'] },
        till: { value: ['milk', 'gluten'] },
      }),
    )
    expect(outcome.field.provenance).toBe('overridden')
  })
})

describe('localized_text resolves per locale (D24)', () => {
  it("uses till's text where till holds the locale and ours where it does not", () => {
    const outcome = combineField(
      input(name, {
        till: { value: { bg_BG: 'Негрони' } },
        manual: { value: { bg_BG: 'Ръчно', en_US: 'Negroni' } },
      }),
    )
    expect(outcome.field).toEqual({
      value: { bg_BG: 'Негрони', en_US: 'Negroni' },
      provenance: 'till',
      layer: 'till',
      locales: {
        bg_BG: { provenance: 'till', layer: 'till' },
        en_US: { provenance: 'owned', layer: 'manual' },
      },
    })
  })

  it('an override of one locale replaces only that locale', () => {
    const till = { bg_BG: 'Негрони', en_US: 'Negroni' }
    const outcome = combineField(
      input(name, {
        override: { value: { en_US: 'The Negroni' }, basis: till },
        till: { value: till },
      }),
    )
    expect(outcome.field.value).toEqual({ bg_BG: 'Негрони', en_US: 'The Negroni' })
    expect(outcome.field.locales?.en_US).toEqual({ provenance: 'overridden', layer: 'override' })
    expect(outcome.field.provenance).toBe('till')
  })

  it('builder_first copy wins per locale and falls back to till per locale', () => {
    const outcome = combineField(
      input(description, {
        till: { value: { bg_BG: 'От till', en_US: 'From till' } },
        manual: { value: { en_US: 'Our copy' } },
      }),
    )
    expect(outcome.field.value).toEqual({ bg_BG: 'От till', en_US: 'Our copy' })
    expect(outcome.field.provenance).toBe('till')
    expect(outcome.field.locales?.en_US?.provenance).toBe('owned')
  })

  it('takes the field provenance from the default language when it has text', () => {
    const outcome = combineField(
      input(description, {
        till: { value: { en_US: 'From till' } },
        manual: { value: { bg_BG: 'Наше' } },
      }),
    )
    expect(outcome.field.provenance).toBe('owned')
    expect(outcome.field.layer).toBe('manual')
  })

  it("flags our translation when till's text changed after it (translation_review)", () => {
    const later = combineField(
      input(name, {
        till: { value: { bg_BG: 'Негрони 2' }, observedAt: '2026-10-05T10:00:00+03:00' },
        manual: { value: { en_US: 'Negroni' }, observedAt: '2026-10-02T10:00:00+03:00' },
      }),
    )
    expect(later.issues).toEqual([
      { code: 'translation_review', severity: 'warning', locale: 'en_US' },
    ])
    const earlier = combineField(
      input(name, {
        till: { value: { bg_BG: 'Негрони' }, observedAt: '2026-10-01T10:00:00+03:00' },
        manual: { value: { en_US: 'Negroni' }, observedAt: '2026-10-02T10:00:00+03:00' },
      }),
    )
    expect(earlier.issues).toEqual([])
  })
})

describe('locked (price)', () => {
  it('reads till only on a linked node and shows it as locked', () => {
    expect(combineField(input(price, { till: { value: eur(1250), scope: VENUE } })).field).toEqual({
      value: eur(1250),
      provenance: 'locked',
      layer: 'till',
    })
  })

  it('stays locked with no value when till has no price', () => {
    expect(combineField(input(price, {})).field).toEqual({
      value: null,
      provenance: 'locked',
      layer: null,
    })
  })

  it('is source_first on a hand-made (unlinked) node', () => {
    expect(combineField(input(price, { manual: { value: eur(900) } }, false)).field).toEqual({
      value: eur(900),
      provenance: 'owned',
      layer: 'manual',
    })
  })

  it('never reads manual, override or edition layers on a linked node', () => {
    for (const layer of ['manual', 'override', 'edition:tonight'] as const) {
      expect(readsLayer(price, true, layer)).toBe(false)
      expect(readsLayer(price, false, layer)).toBe(layer !== 'edition:tonight')
    }
    expect(readsLayer(price, true, 'till')).toBe(true)
  })
})

describe('all_true (visible, for_sale)', () => {
  it('is true only if every layer that has a value says true', () => {
    expect(
      combineField(input(visible, { till: { value: true }, manual: { value: true } })).field,
    ).toEqual({ value: true, provenance: 'till', layer: 'till' })
    expect(
      combineField(input(visible, { till: { value: true }, manual: { value: false } })).field,
    ).toEqual({ value: false, provenance: 'owned', layer: 'manual' })
  })

  it('names the till when the till says false (its hiding wins at once)', () => {
    expect(
      combineField(input(forSale, { till: { value: false }, manual: { value: false } })).field,
    ).toEqual({ value: false, provenance: 'till', layer: 'till' })
  })

  it("a builder true never makes the till's false true (rule 5)", () => {
    for (const layer of ['manual', 'override', 'edition:tonight'] as const) {
      const outcome = combineField(
        input(forSale, { till: { value: false }, [layer]: { value: true } }),
      )
      expect(outcome.field.value).toBe(false)
    }
  })

  it('reads edition layers (sold out tonight)', () => {
    expect(
      combineField(input(forSale, { till: { value: true }, 'edition:tonight': { value: false } }))
        .field,
    ).toEqual({ value: false, provenance: 'owned', layer: 'edition:tonight' })
    expect(readsLayer(forSale, true, 'edition:tonight')).toBe(true)
  })

  it('has no value when no layer holds one and there is no default', () => {
    expect(combineField(input(forSale, {})).field).toEqual({
      value: null,
      provenance: 'none',
      layer: null,
    })
    const withDefault = def('item', 'for_sale', { default: true })
    expect(combineField(input(withDefault, {})).field.value).toBe(true)
  })
})

describe('union (dietary, tags)', () => {
  it('unites every layer; enum sets in option order', () => {
    const outcome = combineField(
      input(dietary, {
        till: { value: ['vegan'] },
        manual: { value: ['gluten_free', 'vegetarian'] },
      }),
    )
    expect(outcome.field).toEqual({
      value: ['vegan', 'vegetarian', 'gluten_free'],
      provenance: 'owned',
      layer: 'manual',
    })
  })

  it('keeps tags in first-seen order, builder first, without repeats', () => {
    const outcome = combineField(
      input(tags, {
        till: { value: ['house', 'new'] },
        manual: { value: ['signature', 'house'] },
      }),
    )
    expect(outcome.field.value).toEqual(['signature', 'house', 'new'])
  })

  it("is till's when only till contributes; none when nobody does", () => {
    expect(combineField(input(tags, { till: { value: ['house'] } })).field.provenance).toBe('till')
    expect(combineField(input(tags, {})).field).toEqual({
      value: null,
      provenance: 'none',
      layer: null,
    })
  })
})

describe('must_agree (allergens)', () => {
  it('agreeing layers give their value', () => {
    const outcome = combineField(
      input(allergens, {
        till: { value: ['milk', 'gluten'] },
        manual: { value: ['gluten', 'milk'] },
      }),
    )
    expect(outcome.field).toEqual({
      value: ['milk', 'gluten'],
      provenance: 'till',
      layer: 'till',
    })
    expect(outcome.issues).toEqual([])
  })

  it('disagreeing layers are a conflict showing every claimed allergen; V5 is a warning (D42)', () => {
    const outcome = combineField(
      input(allergens, { till: { value: ['milk'] }, manual: { value: ['gluten'] } }),
    )
    expect(outcome.field).toEqual({
      value: ['gluten', 'milk'],
      provenance: 'till',
      layer: 'till',
      conflict: true,
    })
    expect(outcome.issues).toEqual([{ code: 'V5', severity: 'warning' }])
  })

  it("an explicit empty set disagrees with till's allergens", () => {
    const outcome = combineField(
      input(allergens, { till: { value: ['milk'] }, manual: { value: [] } }),
    )
    expect(outcome.field.conflict).toBe(true)
  })

  it("a person's choice (override) resolves the conflict", () => {
    const outcome = combineField(
      input(allergens, {
        override: { value: ['milk'], basis: ['milk'] },
        till: { value: ['milk'] },
        manual: { value: ['gluten'] },
      }),
    )
    expect(outcome.field).toEqual({ value: ['milk'], provenance: 'overridden', layer: 'override' })
    expect(outcome.issues).toEqual([])
  })

  it('the conflict re-opens when till changes after the choice', () => {
    const outcome = combineField(
      input(allergens, {
        override: { value: ['milk'], basis: ['milk'] },
        till: { value: ['milk', 'eggs'] },
      }),
    )
    expect(outcome.field).toEqual({
      value: ['eggs', 'milk'],
      provenance: 'stale',
      layer: 'override',
      conflict: true,
    })
    expect(outcome.issues).toEqual([
      { code: 'stale_override', severity: 'warning' },
      { code: 'V5', severity: 'warning' },
    ])
  })

  it('a critical must_agree field blocks its node on conflict', () => {
    const critical = def('item', 'allergens', { critical: true })
    const outcome = combineField(
      input(critical, { till: { value: ['milk'] }, manual: { value: [] } }),
    )
    expect(outcome.issues).toEqual([{ code: 'V5', severity: 'block_node' }])
  })
})

describe('builder_first (description, image, order_mode)', () => {
  it('prefers manual, then the till, then the default', () => {
    expect(combineField(input(orderMode, {})).field).toEqual({
      value: 'orderable',
      provenance: 'none',
      layer: 'default',
    })
    expect(
      combineField(input(orderMode, { manual: { value: 'ask_waiter' }, till: { value: 'hidden' } }))
        .field,
    ).toEqual({ value: 'ask_waiter', provenance: 'owned', layer: 'manual' })
    expect(combineField(input(orderMode, { till: { value: 'hidden' } })).field).toEqual({
      value: 'hidden',
      provenance: 'till',
      layer: 'till',
    })
  })

  it('never reads overrides or editions', () => {
    expect(readsLayer(description, true, 'override')).toBe(false)
    expect(readsLayer(description, true, 'edition:tonight')).toBe(false)
    expect(readsLayer(description, true, 'till')).toBe(true)
  })
})
