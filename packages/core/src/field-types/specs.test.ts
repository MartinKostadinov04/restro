import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ALLERGENS } from '../allergens'
import { newId } from '../ids'
import { FIELD_TYPE_NAMES, type FieldType } from './catalog'
import { FIELD_TYPES, type FieldRules, type FieldTypeSpec } from './specs'

const asset = newId('as')
const node = newId('nd')

interface Samples {
  /** Valid values under `rules`; the first one is used for the hash checks. */
  readonly valid: readonly unknown[]
  readonly invalid: readonly unknown[]
  /** Valid values `isEmpty` must report as empty. */
  readonly empty: readonly unknown[]
  /** A valid value equal to `valid[0]` written differently (key or set order). */
  readonly equalTo0?: unknown
  readonly rules?: Partial<FieldRules>
}

const SAMPLES: { readonly [K in FieldType]: Samples } = {
  short_text: {
    valid: ['Negroni', '', 'Негрони'],
    invalid: ['two\nlines', 'carriage\rreturn', 12, null, { text: 'x' }],
    empty: ['', '   '],
  },
  long_text: {
    valid: ['Gin, Campari,\nvermouth', ''],
    invalid: [12, null, ['a']],
    empty: ['', '\n  '],
  },
  localized_text: {
    valid: [{ bg_BG: 'Негрони', en_US: 'Negroni' }, {}, { tr_TR: 'Negroni' }],
    invalid: [{ xx_XX: 'Negroni' }, { en_US: '' }, { en_US: 12 }, 'Negroni', null],
    empty: [{}, { en_US: '  ' }],
    equalTo0: { en_US: 'Negroni', bg_BG: 'Негрони' },
  },
  number: {
    valid: [12.5, 0, -3],
    invalid: [Number.NaN, Number.POSITIVE_INFINITY, '12.5', null],
    empty: [],
  },
  boolean: { valid: [true, false], invalid: ['true', 1, null], empty: [] },
  date: {
    valid: ['2026-12-31', '2024-02-29'],
    invalid: ['2026-02-29', '31.12.2026', '2026-12-31T00:00:00Z', 20261231],
    empty: [],
  },
  datetime: {
    valid: ['2026-12-31T23:00:00+02:00', '2026-12-31T21:00:00Z', '2026-12-31T23:00:00.250+02:00'],
    invalid: [
      '2026-12-31T23:00:00',
      '2026-12-31 23:00:00+02:00',
      '2026-12-31T23:00+02:00',
      '2026-12-31',
    ],
    empty: [],
  },
  money: {
    valid: [
      { amount_minor: 1250, currency: 'EUR' },
      { amount_minor: 0, currency: 'EUR' },
    ],
    invalid: [
      { amount_minor: 12.5, currency: 'EUR' },
      { amount_minor: -100, currency: 'EUR' },
      { amount_minor: 100, currency: 'USD' },
      { amount_minor: 100 },
      1250,
    ],
    empty: [],
    equalTo0: { currency: 'EUR', amount_minor: 1250 },
  },
  measurement: {
    valid: [
      { value: 250, unit: 'ml' },
      { value: 0.5, unit: 'l' },
      { value: 2, unit: 'pcs' },
    ],
    invalid: [
      { value: 250, unit: 'oz' },
      { value: 0, unit: 'ml' },
      { value: -1, unit: 'g' },
      '250 ml',
    ],
    empty: [],
  },
  range: {
    valid: [
      { start: 0, end: 3, unit: null, stops: [1, 2] },
      { start: 5, end: 5, unit: 'cl', stops: [] },
    ],
    invalid: [
      { start: 3, end: 0, unit: null, stops: [] },
      { start: 0, end: 3, unit: null, stops: [2, 1] },
      { start: 0, end: 3, unit: null, stops: [4] },
      { start: 0, end: 3, stops: [] },
      { start: 0, end: 3, unit: '%', stops: [] },
    ],
    empty: [],
  },
  tags: {
    valid: [['signature', 'new'], []],
    invalid: [['new', 'new'], [''], 'signature', [1]],
    empty: [[]],
    equalTo0: ['new', 'signature'],
  },
  enum: {
    valid: ['vegetarian'],
    invalid: ['carnivore', '', ['vegetarian'], null],
    empty: [],
    rules: { options: ['vegetarian', 'vegan'] },
  },
  enum_set: {
    valid: [['gluten', 'milk', 'sulphites'], []],
    invalid: [['gluten', 'gluten'], ['peanut'], 'gluten', [null]],
    empty: [],
    equalTo0: ['sulphites', 'gluten', 'milk'],
    rules: { options: [...ALLERGENS] },
  },
  image: {
    valid: [
      { asset_id: asset, alt: { en_US: 'Negroni on ice' }, focal: { x: 0.5, y: 0.4 } },
      { asset_id: asset, alt: {}, focal: null },
    ],
    invalid: [
      { asset_id: 'https://cdn.example.com/a.jpg', alt: {}, focal: null },
      { asset_id: node, alt: {}, focal: null },
      { asset_id: asset, alt: {}, focal: { x: 1.5, y: 0 } },
      { asset_id: asset },
      { asset_id: asset, alt: {}, focal: null, url: 'https://cdn.example.com/a.jpg' },
    ],
    empty: [],
    equalTo0: { focal: { y: 0.4, x: 0.5 }, alt: { en_US: 'Negroni on ice' }, asset_id: asset },
  },
  file: {
    valid: [{ asset_id: asset, filename: 'allergens.pdf', size: 182044 }],
    invalid: [
      { asset_id: asset, filename: '../etc/passwd', size: 1 },
      { asset_id: asset, filename: '', size: 1 },
      { asset_id: asset, filename: 'a.pdf', size: -1 },
      { asset_id: asset, filename: 'a.pdf', size: 1.5 },
    ],
    empty: [],
  },
  availability: {
    valid: [
      {
        timezone: 'Europe/Sofia',
        rules: [
          { days: [5, 6], from: '22:00', to: '04:00' },
          { days: [7], from: '18:00', to: '24:00' },
        ],
      },
      { timezone: 'Europe/Sofia', rules: [] },
    ],
    invalid: [
      { timezone: 'Mars/Olympus', rules: [] },
      { timezone: 'Europe/Sofia', rules: [{ days: [0], from: '22:00', to: '04:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [8], from: '22:00', to: '04:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [], from: '22:00', to: '04:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [5, 5], from: '22:00', to: '04:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [5], from: '22:00', to: '22:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [5], from: '24:00', to: '04:00' }] },
      { timezone: 'Europe/Sofia', rules: [{ days: [5], from: '9:00', to: '17:00' }] },
    ],
    empty: [{ timezone: 'Europe/Sofia', rules: [] }],
    equalTo0: {
      rules: [
        { days: [7], from: '18:00', to: '24:00' },
        { to: '04:00', from: '22:00', days: [6, 5] },
      ],
      timezone: 'Europe/Sofia',
    },
  },
  reference: {
    valid: [{ node_id: node }],
    invalid: [{ node_id: asset }, { node_id: '102751' }, node],
    empty: [],
  },
}

function rulesFor(type: FieldType): FieldRules {
  return { type, constraints: {}, ...SAMPLES[type].rules }
}

describe('field-type specs', () => {
  it('has a spec for every field type, keyed by its own type', () => {
    expect(Object.keys(FIELD_TYPES).sort()).toEqual([...FIELD_TYPE_NAMES].sort())
    for (const type of FIELD_TYPE_NAMES) expect(FIELD_TYPES[type].type).toBe(type)
  })

  it('makes a registry with a missing type a compile error', () => {
    // @ts-expect-error every FieldType needs a spec; typecheck fails if this ever compiles
    const incomplete: { readonly [K in FieldType]: FieldTypeSpec<K> } = {
      short_text: FIELD_TYPES.short_text,
    }
    expect(Object.keys(incomplete)).toHaveLength(1)
  })

  describe.each(FIELD_TYPE_NAMES)('%s', (type) => {
    const spec = FIELD_TYPES[type]
    const samples = SAMPLES[type]
    const rules = rulesFor(type)

    it('accepts valid samples', () => {
      for (const value of samples.valid) {
        expect(spec.validate(value, rules), JSON.stringify(value)).toEqual({ ok: true })
      }
    })

    it('rejects invalid samples with a reason', () => {
      for (const value of samples.invalid) {
        const verdict = spec.validate(value, rules)
        expect(verdict.ok, JSON.stringify(value)).toBe(false)
        if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0)
      }
    })

    it('reports emptiness', () => {
      const isEmpty = spec.isEmpty as (value: unknown) => boolean
      for (const value of samples.empty) expect(isEmpty(value), JSON.stringify(value)).toBe(true)
      expect(isEmpty(samples.valid[0])).toBe(false)
    })

    it('hashes equal values equally and different values differently', () => {
      const hash = spec.hash as (value: unknown) => string
      const first = samples.valid[0]
      expect(hash(first)).toMatch(/^[0-9a-f]{64}$/)
      expect(hash(structuredClone(first))).toBe(hash(first))
      if (samples.equalTo0 !== undefined) expect(hash(samples.equalTo0)).toBe(hash(first))
      for (const other of samples.valid.slice(1)) expect(hash(other)).not.toBe(hash(first))
    })
  })

  it('treats an explicit empty enum_set as a value (allergens: "contains none")', () => {
    expect(FIELD_TYPES.enum_set.isEmpty([])).toBe(false)
  })

  it('uses V2 for money shape failures and V1 for constraint failures', () => {
    const rules: FieldRules = { type: 'money', constraints: { min_minor: 100 } }
    expect(
      FIELD_TYPES.money.validate({ amount_minor: 12.5, currency: 'EUR' }, rules),
    ).toMatchObject({
      ok: false,
      code: 'V2',
    })
    expect(FIELD_TYPES.money.validate({ amount_minor: 50, currency: 'EUR' }, rules)).toMatchObject({
      ok: false,
      code: 'V1',
    })
  })

  it('applies definition constraints', () => {
    const text: FieldRules = { type: 'short_text', constraints: { max_length: 3 } }
    expect(FIELD_TYPES.short_text.validate('Ром', text).ok).toBe(true)
    expect(FIELD_TYPES.short_text.validate('Ракия', text).ok).toBe(false)
    const number: FieldRules = { type: 'number', constraints: { min: 0, max: 100, integer: true } }
    expect(FIELD_TYPES.number.validate(40, number).ok).toBe(true)
    expect(FIELD_TYPES.number.validate(40.5, number).ok).toBe(false)
    expect(FIELD_TYPES.number.validate(101, number).ok).toBe(false)
    const units: FieldRules = { type: 'measurement', constraints: { units: ['ml', 'cl'] } }
    expect(FIELD_TYPES.measurement.validate({ value: 4, unit: 'cl' }, units).ok).toBe(true)
    expect(FIELD_TYPES.measurement.validate({ value: 4, unit: 'g' }, units).ok).toBe(false)
    const tags: FieldRules = { type: 'tags', constraints: { max_items: 1 } }
    expect(FIELD_TYPES.tags.validate(['a', 'b'], tags).ok).toBe(false)
    const date: FieldRules = { type: 'date', constraints: { min: '2026-01-01' } }
    expect(FIELD_TYPES.date.validate('2025-12-31', date).ok).toBe(false)
  })

  it('rejects a value checked against another type or with broken constraints', () => {
    expect(FIELD_TYPES.boolean.validate(true, { type: 'number', constraints: {} }).ok).toBe(false)
    expect(FIELD_TYPES.boolean.validate(true, { type: 'boolean', constraints: { x: 1 } }).ok).toBe(
      false,
    )
    expect(FIELD_TYPES.enum.validate('a', { type: 'enum', constraints: {} }).ok).toBe(false)
  })

  it('hashes enum_set and tags independently of order (property)', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...ALLERGENS]),
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 20 }),
        fc.nat(),
        (allergens, tags, seed) => {
          const shuffle = <T>(values: readonly T[]): T[] => {
            const copy = [...values]
            for (let i = copy.length - 1; i > 0; i--) {
              const j = (seed + i * 7919) % (i + 1)
              ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
            }
            return copy
          }
          expect(FIELD_TYPES.enum_set.hash(shuffle(allergens))).toBe(
            FIELD_TYPES.enum_set.hash(allergens),
          )
          expect(FIELD_TYPES.tags.hash(shuffle(tags))).toBe(FIELD_TYPES.tags.hash(tags))
          expect(FIELD_TYPES.tags.hash([...tags].reverse())).toBe(FIELD_TYPES.tags.hash(tags))
        },
      ),
    )
  })
})
