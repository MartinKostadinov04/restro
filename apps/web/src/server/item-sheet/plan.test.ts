import {
  ALLERGENS,
  type FieldDefinition,
  type FieldWrite,
  findField,
  LOCALES,
  type LocalizedText,
  VENUE_MENU_TEMPLATE,
  validateWrite,
} from '@restro/core'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { LayerEntry, LayerView } from './layers'
import {
  type Plan,
  type PlanContext,
  type PlannedWrite,
  planFieldSave,
  planKeepOverride,
  planRevert,
  planTranslation,
  sameFieldValue,
} from './plan'

function definition(key: string): FieldDefinition {
  const found = findField(VENUE_MENU_TEMPLATE, 'item', key)
  if (!found) throw new Error(`no item field ${key}`)
  return found
}

const entry = (value: unknown, basis: unknown | null = null): LayerEntry => ({
  value,
  basis,
  scope: 'master',
  observedAt: '2026-10-01T10:00:00.000Z',
})

function context(key: string, options: { linked?: boolean; layers?: LayerView } = {}): PlanContext {
  return {
    definition: definition(key),
    linkedToBarsy: options.linked ?? true,
    layers: options.layers ?? {},
  }
}

function writesOf(plan: Plan): readonly PlannedWrite[] {
  if (!plan.ok) throw new Error(`refused: ${plan.refusal}`)
  return plan.writes
}

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

describe('builder-owned fields go to the manual layer', () => {
  it('writes the manual layer of description, abv, order_mode and internal_note', () => {
    expect(writesOf(planFieldSave(context('abv'), 24))).toEqual([
      { kind: 'set', layer: 'manual', value: 24 },
    ])
    expect(writesOf(planFieldSave(context('order_mode'), 'ask_waiter'))).toEqual([
      { kind: 'set', layer: 'manual', value: 'ask_waiter' },
    ])
    expect(writesOf(planFieldSave(context('internal_note'), 'Order Campari'))).toEqual([
      { kind: 'set', layer: 'manual', value: 'Order Campari' },
    ])
    expect(writesOf(planFieldSave(context('description'), { bg_BG: 'Горчив' }))).toEqual([
      { kind: 'set', layer: 'manual', value: { bg_BG: 'Горчив' } },
    ])
  })

  it('clearing a builder-owned value removes the manual value, and nothing if there is none', () => {
    const layers = { manual: entry(24) }
    expect(writesOf(planFieldSave(context('abv', { layers }), undefined))).toEqual([
      { kind: 'clear', layer: 'manual' },
    ])
    expect(writesOf(planFieldSave(context('abv'), undefined))).toEqual([])
  })

  it('never overrides a builder-owned field, even when barsy holds a value', () => {
    const layers = { barsy: entry({ bg_BG: 'От barsy' }) }
    const writes = writesOf(planFieldSave(context('description', { layers }), { bg_BG: 'Мое' }))
    expect(writes).toEqual([{ kind: 'set', layer: 'manual', value: { bg_BG: 'Мое' } }])
  })

  it('does not copy a fallback text from barsy into manual: only what changed is written', () => {
    const layers = { barsy: entry({ bg_BG: 'От barsy', en_US: 'From barsy' }) }
    // The editor holds both resolved texts; the person only changed English.
    const writes = writesOf(
      planFieldSave(context('description', { layers }), {
        bg_BG: 'От barsy',
        en_US: 'Our own words',
      }),
    )
    expect(writes).toEqual([{ kind: 'set', layer: 'manual', value: { en_US: 'Our own words' } }])
    // Saving the untouched fallbacks writes nothing.
    expect(
      writesOf(
        planFieldSave(context('description', { layers }), {
          bg_BG: 'От barsy',
          en_US: 'From barsy',
        }),
      ),
    ).toEqual([])
  })

  it('keeps a language already in the manual layer even when it equals the fallback', () => {
    const layers = {
      barsy: entry({ bg_BG: 'Същото' }),
      manual: entry({ bg_BG: 'Същото', en_US: 'Same' }),
    }
    expect(
      writesOf(
        planFieldSave(context('description', { layers }), { bg_BG: 'Същото', en_US: 'Same' }),
      ),
    ).toEqual([])
  })

  it('removes a language the person emptied, and the whole value when none is left', () => {
    const layers = { manual: entry({ bg_BG: 'Едно', en_US: 'One' }) }
    expect(writesOf(planFieldSave(context('description', { layers }), { bg_BG: 'Едно' }))).toEqual([
      { kind: 'set', layer: 'manual', value: { bg_BG: 'Едно' } },
    ])
    expect(writesOf(planFieldSave(context('description', { layers }), undefined))).toEqual([
      { kind: 'clear', layer: 'manual' },
    ])
  })
})

describe('barsy-owned, overridable fields: override with a basis, or manual', () => {
  it("overrides a linked item's allergens with barsy's current value as the basis", () => {
    const layers = { barsy: entry(['gluten']) }
    expect(writesOf(planFieldSave(context('allergens', { layers }), ['gluten', 'milk']))).toEqual([
      { kind: 'set', layer: 'override', value: ['gluten', 'milk'], basis: ['gluten'] },
    ])
  })

  it('writes the manual layer when barsy holds no value for the field', () => {
    expect(writesOf(planFieldSave(context('allergens'), ['milk']))).toEqual([
      { kind: 'set', layer: 'manual', value: ['milk'] },
    ])
    expect(writesOf(planFieldSave(context('portion'), { value: 80, unit: 'ml' }))).toEqual([
      { kind: 'set', layer: 'manual', value: { value: 80, unit: 'ml' } },
    ])
  })

  it('writes the manual layer for an item with no barsy link, whatever the field', () => {
    for (const [key, value] of [
      ['allergens', ['milk']],
      ['portion', { value: 80, unit: 'ml' }],
      ['price', eur(900)],
    ] as const) {
      expect(writesOf(planFieldSave(context(key, { linked: false }), value))).toEqual([
        { kind: 'set', layer: 'manual', value },
      ])
    }
  })

  it("says nothing new when a source_first field is set to barsy's own value", () => {
    const layers = {
      barsy: entry({ value: 80, unit: 'ml' }),
      override: entry({ value: 90, unit: 'ml' }, { value: 80, unit: 'ml' }),
    }
    expect(
      writesOf(planFieldSave(context('portion', { layers }), { value: 80, unit: 'ml' })),
    ).toEqual([{ kind: 'clear', layer: 'override' }])
    expect(
      writesOf(
        planFieldSave(context('portion', { layers: { barsy: layers.barsy } }), {
          value: 80,
          unit: 'ml',
        }),
      ),
    ).toEqual([])
  })

  it("records an override even for barsy's own value on a must_agree field (it settles a conflict)", () => {
    const layers = { barsy: entry(['gluten']), manual: entry(['milk']) }
    expect(writesOf(planFieldSave(context('allergens', { layers }), ['gluten']))).toEqual([
      { kind: 'set', layer: 'override', value: ['gluten'], basis: ['gluten'] },
    ])
  })

  it('clearing an overridden value reverts it', () => {
    const layers = { barsy: entry(['gluten']), override: entry(['milk'], ['gluten']) }
    expect(writesOf(planFieldSave(context('allergens', { layers }), undefined))).toEqual([
      { kind: 'clear', layer: 'override' },
    ])
  })

  it('refreshes the basis when an override is saved again after barsy changed', () => {
    const layers = { barsy: entry(['gluten', 'eggs']), override: entry(['milk'], ['gluten']) }
    expect(writesOf(planFieldSave(context('allergens', { layers }), ['milk']))).toEqual([
      { kind: 'set', layer: 'override', value: ['milk'], basis: ['gluten', 'eggs'] },
    ])
  })
})

describe('the display name: per language (D24)', () => {
  const layers: LayerView = { barsy: entry({ bg_BG: 'Негрони' }) }

  it("overrides a language barsy holds, with barsy's whole name as the basis", () => {
    expect(
      writesOf(planFieldSave(context('name', { layers }), { bg_BG: 'Негрони Класик' })),
    ).toEqual([
      {
        kind: 'set',
        layer: 'override',
        value: { bg_BG: 'Негрони Класик' },
        basis: { bg_BG: 'Негрони' },
      },
    ])
  })

  it('saves a language barsy lacks as a manual translation, not an override', () => {
    expect(
      writesOf(planFieldSave(context('name', { layers }), { bg_BG: 'Негрони', en_US: 'Negroni' })),
    ).toEqual([{ kind: 'set', layer: 'manual', value: { en_US: 'Negroni' } }])
  })

  it('splits one edit of both languages into the override and the manual layer', () => {
    const writes = writesOf(
      planFieldSave(context('name', { layers }), { bg_BG: 'Негрони Класик', en_US: 'Negroni' }),
    )
    expect(writes).toEqual([
      {
        kind: 'set',
        layer: 'override',
        value: { bg_BG: 'Негрони Класик' },
        basis: { bg_BG: 'Негрони' },
      },
      { kind: 'set', layer: 'manual', value: { en_US: 'Negroni' } },
    ])
  })

  it('writes nothing when the editor comes back unchanged', () => {
    expect(writesOf(planFieldSave(context('name', { layers }), { bg_BG: 'Негрони' }))).toEqual([])
  })

  it('drops the override of a language once it says what barsy says again', () => {
    const withOverride: LayerView = {
      barsy: entry({ bg_BG: 'Негрони' }),
      override: entry({ bg_BG: 'Негрони Класик' }, { bg_BG: 'Негрони' }),
    }
    expect(
      writesOf(planFieldSave(context('name', { layers: withOverride }), { bg_BG: 'Негрони' })),
    ).toEqual([{ kind: 'clear', layer: 'override' }])
  })

  it('leaves a translation that barsy has since taken over untouched', () => {
    const shadowed: LayerView = {
      barsy: entry({ bg_BG: 'Негрони', en_US: 'Negroni (barsy)' }),
      manual: entry({ en_US: 'Negroni (ours)' }),
    }
    expect(
      writesOf(
        planFieldSave(context('name', { layers: shadowed }), {
          bg_BG: 'Негрони',
          en_US: 'Negroni (barsy)',
        }),
      ),
    ).toEqual([])
  })

  it('is a plain manual value on an item with no barsy link', () => {
    expect(
      writesOf(
        planFieldSave(context('name', { linked: false }), { bg_BG: 'Домашно', en_US: 'House' }),
      ),
    ).toEqual([{ kind: 'set', layer: 'manual', value: { bg_BG: 'Домашно', en_US: 'House' } }])
  })
})

describe('locked and read-only fields', () => {
  it('refuses the price of a linked item: change it in barsy', () => {
    const plan = planFieldSave(context('price', { layers: { barsy: entry(eur(450)) } }), eur(500))
    expect(plan).toEqual({ ok: false, refusal: 'locked' })
  })

  it('refuses the flags that can only get more cautious elsewhere', () => {
    expect(planFieldSave(context('visible'), false)).toEqual({ ok: false, refusal: 'read_only' })
    expect(planFieldSave(context('for_sale'), false)).toEqual({ ok: false, refusal: 'read_only' })
    expect(planFieldSave(context('visible', { linked: false }), true)).toEqual({
      ok: false,
      refusal: 'read_only',
    })
  })
})

describe('revert and keep', () => {
  it('reverting clears the override; nothing to revert is refused', () => {
    const layers = { barsy: entry(['gluten']), override: entry(['milk'], ['gluten']) }
    expect(writesOf(planRevert(context('allergens', { layers })))).toEqual([
      { kind: 'clear', layer: 'override' },
    ])
    expect(planRevert(context('allergens'))).toEqual({ ok: false, refusal: 'nothing_to_revert' })
  })

  it("keeping re-records the override over barsy's current value", () => {
    const layers = { barsy: entry(['gluten', 'eggs']), override: entry(['milk'], ['gluten']) }
    expect(writesOf(planKeepOverride(context('allergens', { layers })))).toEqual([
      { kind: 'set', layer: 'override', value: ['milk'], basis: ['gluten', 'eggs'] },
    ])
  })

  it('cannot keep an override when barsy no longer holds a value, or when there is none', () => {
    expect(
      planKeepOverride(context('allergens', { layers: { override: entry(['milk'], ['gluten']) } })),
    ).toEqual({ ok: false, refusal: 'no_basis' })
    expect(planKeepOverride(context('allergens'))).toEqual({
      ok: false,
      refusal: 'nothing_to_revert',
    })
  })
})

describe('translations', () => {
  it('adds a language barsy lacks to the manual layer, keeping the others', () => {
    const layers = { barsy: entry({ bg_BG: 'Негрони' }), manual: entry({ de_DE: 'Negroni' }) }
    expect(writesOf(planTranslation(context('name', { layers }), 'en_US', 'Negroni'))).toEqual([
      { kind: 'set', layer: 'manual', value: { en_US: 'Negroni', de_DE: 'Negroni' } },
    ])
  })

  it('is read-only where barsy holds the language of a barsy-owned field', () => {
    const layers = { barsy: entry({ bg_BG: 'Негрони' }) }
    expect(planTranslation(context('name', { layers }), 'bg_BG', 'Друго')).toEqual({
      ok: false,
      refusal: 'locked',
    })
  })

  it("may write over barsy's text of a builder-owned field (barsy is only the fallback)", () => {
    const layers = { barsy: entry({ bg_BG: 'От barsy' }) }
    expect(writesOf(planTranslation(context('description', { layers }), 'bg_BG', 'Наше'))).toEqual([
      { kind: 'set', layer: 'manual', value: { bg_BG: 'Наше' } },
    ])
  })

  it('removes a language when the text is emptied, and the layer when none is left', () => {
    const layers = { manual: entry({ en_US: 'Negroni' }) }
    expect(writesOf(planTranslation(context('name', { layers }), 'en_US', '  '))).toEqual([
      { kind: 'clear', layer: 'manual' },
    ])
    expect(writesOf(planTranslation(context('name'), 'en_US', undefined))).toEqual([])
  })

  it('writes nothing when the text did not change', () => {
    const layers = { manual: entry({ en_US: 'Negroni' }) }
    expect(writesOf(planTranslation(context('name', { layers }), 'en_US', 'Negroni'))).toEqual([])
  })

  it('refuses a field that is not text in several languages', () => {
    expect(planTranslation(context('abv'), 'en_US', 'x')).toEqual({
      ok: false,
      refusal: 'read_only',
    })
  })
})

describe('sameFieldValue', () => {
  it('compares sets without regard to order and falls back to JSON for unreadable values', () => {
    const allergens = definition('allergens')
    expect(sameFieldValue(allergens, ['milk', 'gluten'], ['gluten', 'milk'])).toBe(true)
    expect(sameFieldValue(allergens, ['milk'], ['gluten'])).toBe(false)
    expect(sameFieldValue(allergens, { a: 1 }, { a: 1 })).toBe(true)
    expect(sameFieldValue(allergens, 5, undefined)).toBe(false)
  })
})

// --- property: whatever the plan writes, apply() would accept it (rule 5 and the ownership matrix)

const localeText = fc
  .dictionary(
    fc.constantFrom(...LOCALES),
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((text) => text.trim() !== '' && !/[\r\n]/.test(text)),
  )
  .map((text) => text as LocalizedText)
const allergenSet = fc.subarray([...ALLERGENS]).map((set) => [...set])
const measurement = fc.record({
  value: fc.integer({ min: 1, max: 2000 }),
  unit: fc.constantFrom('g', 'ml', 'cl'),
})

function asWrite(key: string, write: PlannedWrite): FieldWrite | null {
  if (write.kind === 'clear') return null
  return {
    op: 'setField',
    node: { id: 'nd_0123456789ABCDEFGHIJKL' },
    fieldKey: key,
    layer: write.layer,
    scope: 'master',
    value: write.value as FieldWrite['value'],
    ...(write.layer === 'override' ? { basis: write.basis as FieldWrite['basis'] } : {}),
  } as FieldWrite
}

describe('every planned write passes write validation (property)', () => {
  const cases: [string, fc.Arbitrary<unknown>, fc.Arbitrary<LayerView>][] = [
    [
      'name',
      localeText,
      fc.record({
        barsy: fc.option(
          localeText.map((v) => entry(v)),
          { nil: undefined },
        ),
      }),
    ],
    [
      'description',
      localeText,
      fc.record({
        barsy: fc.option(
          localeText.map((v) => entry(v)),
          { nil: undefined },
        ),
      }),
    ],
    [
      'allergens',
      allergenSet,
      fc.record({
        barsy: fc.option(
          allergenSet.map((v) => entry(v)),
          { nil: undefined },
        ),
      }),
    ],
    [
      'portion',
      measurement,
      fc.record({
        barsy: fc.option(
          measurement.map((v) => entry(v)),
          { nil: undefined },
        ),
      }),
    ],
  ]

  for (const [key, edited, layers] of cases) {
    for (const linked of [true, false]) {
      it(`${key}, ${linked ? 'linked' : 'hand-made'}`, () => {
        fc.assert(
          fc.property(edited, layers, (value, view) => {
            // A hand-made item has no barsy value.
            const effective: LayerView = linked ? view : {}
            const plan = planFieldSave(context(key, { linked, layers: effective }), value)
            if (!plan.ok) return
            for (const write of plan.writes) {
              const candidate = asWrite(key, write)
              if (candidate === null) continue
              const verdict = validateWrite(VENUE_MENU_TEMPLATE, 'item', candidate, {
                linkedToBarsy: linked,
              })
              expect(verdict, JSON.stringify(write)).toEqual({ ok: true })
              // Only a linked item has an override, and always over a value barsy holds.
              if (write.layer === 'override') {
                expect(linked).toBe(true)
                expect(effective.barsy).toBeDefined()
              }
            }
          }),
          { numRuns: 200 },
        )
      })
    }
  }

  it('a manual price is written only for an item with no barsy link', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.boolean(), (minor, linked) => {
        const plan = planFieldSave(context('price', { linked }), eur(minor))
        expect(plan.ok).toBe(!linked)
        if (plan.ok) {
          const candidate = asWrite('price', plan.writes[0] as PlannedWrite) as FieldWrite
          expect(
            validateWrite(VENUE_MENU_TEMPLATE, 'item', candidate, { linkedToBarsy: linked }),
          ).toEqual({ ok: true })
        }
      }),
    )
  })
})
