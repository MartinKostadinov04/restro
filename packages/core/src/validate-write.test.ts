import { describe, expect, it } from 'vitest'

import type { FieldWrite, Layer } from './change-set'
import { newId } from './ids'
import { findField } from './template'
import { VENUE_MENU_TEMPLATE } from './templates/venue-menu'
import { layerAllowed, validateWrite } from './validate-write'

const template = VENUE_MENU_TEMPLATE
const node = { id: newId('nd') }

function write(
  fieldKey: string,
  layer: Layer,
  value: unknown,
  extra: Partial<FieldWrite> = {},
): FieldWrite {
  const base: FieldWrite = {
    op: 'setField',
    node,
    fieldKey,
    layer,
    scope: 'master',
    value: value as FieldWrite['value'],
  }
  if (layer === 'barsy') Object.assign(base, { sourceRecordId: 'sr_1', mappingVersion: 1 })
  return { ...base, ...extra }
}

const price = (amount: number) => ({ amount_minor: amount, currency: 'EUR' })

function expectRejected(verdict: ReturnType<typeof validateWrite>, code: string): void {
  expect(verdict.ok).toBe(false)
  if (!verdict.ok) {
    expect(verdict.code).toBe(code)
    expect(verdict.reason.length).toBeGreaterThan(0)
  }
}

describe('validateWrite', () => {
  it('accepts valid writes in allowed layers', () => {
    const ok = [
      validateWrite(template, 'item', write('price', 'barsy', price(1250))),
      validateWrite(template, 'item', write('description', 'manual', { en_US: 'Gin, Campari' })),
      validateWrite(template, 'item', write('allergens', 'barsy', ['sulphites'])),
      validateWrite(template, 'item', write('allergens', 'manual', [])),
      validateWrite(
        template,
        'item',
        write('name', 'override', { en_US: 'Negroni Sbagliato' }, { basis: { en_US: 'Negroni' } }),
      ),
      validateWrite(template, 'item', write('visible', 'barsy', true)),
      validateWrite(template, 'item', write('visible', 'manual', false)),
      validateWrite(template, 'item', write('for_sale', 'edition:service-2026-10-08', false)),
      validateWrite(template, 'item', write('order_mode', 'manual', 'ask_waiter')),
      validateWrite(template, 'option', write('price_delta', 'barsy', price(0))),
      validateWrite(template, 'section', write('title', 'manual', { bg_BG: 'Коктейли' })),
    ]
    for (const verdict of ok) expect(verdict).toEqual({ ok: true })
  })

  it('rejects a price float (V2)', () => {
    expectRejected(validateWrite(template, 'item', write('price', 'barsy', price(12.5))), 'V2')
    expectRejected(validateWrite(template, 'item', write('price', 'barsy', 12.5)), 'V2')
  })

  it('rejects a negative price (V2)', () => {
    expectRejected(validateWrite(template, 'item', write('price', 'barsy', price(-100))), 'V2')
    expectRejected(
      validateWrite(template, 'option', write('price_delta', 'barsy', price(-50))),
      'V2',
    )
  })

  it('rejects a price in an unknown currency (V2)', () => {
    const bgn = { amount_minor: 1250, currency: 'BGN' }
    expectRejected(validateWrite(template, 'item', write('price', 'barsy', bgn)), 'V2')
  })

  it('rejects an unknown allergen (V1)', () => {
    expectRejected(
      validateWrite(template, 'item', write('allergens', 'barsy', ['gluten', 'peanut'])),
      'V1',
    )
  })

  it('rejects a builder write that would un-hide or put back on sale (rule 5)', () => {
    for (const layer of ['manual', 'override', 'edition:venue-1'] as const) {
      const extra = layer === 'override' ? { basis: false } : {}
      expectRejected(
        validateWrite(template, 'item', write('visible', layer, true, extra)),
        'less_cautious',
      )
      expectRejected(
        validateWrite(template, 'item', write('for_sale', layer, true, extra)),
        'less_cautious',
      )
    }
  })

  it('rejects a non-barsy layer on a locked field (price)', () => {
    for (const layer of ['manual', 'import', 'override', 'edition:venue-1'] as const) {
      const extra = layer === 'override' ? { basis: price(1100) } : {}
      expectRejected(
        validateWrite(template, 'item', write('price', layer, price(1250), extra)),
        'layer_not_allowed',
      )
    }
  })

  it('rejects unknown fields and node types', () => {
    expectRejected(
      validateWrite(template, 'item', write('colour', 'manual', 'red')),
      'unknown_field',
    )
    expectRejected(
      validateWrite(template, 'special', write('name', 'manual', {})),
      'unknown_node_type',
    )
  })

  it('rejects overrides where the field is not overridable, and a bad basis', () => {
    expectRejected(
      validateWrite(
        template,
        'item',
        write('description', 'override', { en_US: 'x' }, { basis: { en_US: 'y' } }),
      ),
      'layer_not_allowed',
    )
    expectRejected(
      validateWrite(template, 'modifier_group', write('min', 'override', 1, { basis: 0 })),
      'layer_not_allowed',
    )
    expectRejected(
      validateWrite(
        template,
        'item',
        write('name', 'override', { en_US: 'x' }, { basis: 'Negroni' }),
      ),
      'V1',
    )
  })

  it('limits edition layers to hide / sold-out flags', () => {
    expectRejected(
      validateWrite(template, 'item', write('description', 'edition:venue-1', { en_US: 'x' })),
      'layer_not_allowed',
    )
  })

  it('applies field constraints (V1)', () => {
    expectRejected(validateWrite(template, 'item', write('abv', 'manual', 140)), 'V1')
    expectRejected(validateWrite(template, 'item', write('order_mode', 'manual', 'delivery')), 'V1')
    expectRejected(validateWrite(template, 'modifier_group', write('max', 'barsy', 0)), 'V1')
  })
})

describe('layerAllowed', () => {
  const field = (key: string) => {
    const definition = findField(template, 'item', key)
    if (definition === undefined) throw new Error(key)
    return definition
  }

  it('accepts only the barsy layer on a barsy-owned locked field', () => {
    expect(layerAllowed(field('price'), 'barsy').ok).toBe(true)
    for (const layer of ['import', 'manual', 'override', 'edition:x'] as const) {
      expect(layerAllowed(field('price'), layer).ok, layer).toBe(false)
    }
  })

  it('lets builder layers write builder-owned and overridable fields', () => {
    expect(layerAllowed(field('description'), 'manual').ok).toBe(true)
    expect(layerAllowed(field('description'), 'barsy').ok).toBe(true)
    expect(layerAllowed(field('name'), 'manual').ok).toBe(true)
    expect(layerAllowed(field('name'), 'override').ok).toBe(true)
    expect(layerAllowed(field('visible'), 'edition:venue-1').ok).toBe(true)
  })
})
