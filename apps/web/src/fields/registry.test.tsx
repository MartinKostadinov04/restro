// @vitest-environment jsdom
import {
  ALLERGENS,
  DIETARY_LABELS,
  FIELD_TYPE_NAMES,
  type FieldType,
  ORDER_MODES,
} from '@restro/core'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MESSAGES, renderWithIntl } from '../test-utils'
import { FIELD_REGISTRY, FieldValueView } from './registry'
import { EXTRA_TYPE_SAMPLES, ITEM_SAMPLE_VALUES, itemDefinitions } from './samples'
import type { FieldRegistry } from './types'

describe('the field-type registry (UI side)', () => {
  it('has an entry with a Display and an Editor for every FieldType of @restro/core', () => {
    expect(Object.keys(FIELD_REGISTRY).sort()).toEqual([...FIELD_TYPE_NAMES].sort())
    for (const type of FIELD_TYPE_NAMES) {
      expect(typeof FIELD_REGISTRY[type].Display, `${type}.Display`).toBe('function')
      expect(typeof FIELD_REGISTRY[type].Editor, `${type}.Editor`).toBe('function')
    }
  })

  it('does not compile when a field type is missing (the guarantee behind `satisfies`)', () => {
    // @ts-expect-error `date` is missing, so this object is not a FieldRegistry
    const incomplete = { ...FIELD_REGISTRY, date: undefined } satisfies FieldRegistry
    expect(incomplete.date).toBeUndefined()
    // This test is also checked by `tsc`: remove the directive above and typecheck fails.
    const everyType: readonly FieldType[] = FIELD_TYPE_NAMES
    expect(everyType).toHaveLength(17)
  })

  it('has interface text for every option code of the fixed lists, in both languages', () => {
    for (const language of ['bg', 'en'] as const) {
      const { allergens, dietary, order_mode } = MESSAGES[language].options
      expect(Object.keys(allergens).sort()).toEqual([...ALLERGENS].sort())
      expect(Object.keys(dietary).sort()).toEqual([...DIETARY_LABELS].sort())
      expect(Object.keys(order_mode).sort()).toEqual([...ORDER_MODES].sort())
    }
  })

  it('shows allergens with their EU-14 labels in Bulgarian and in English', () => {
    const allergens = itemDefinitions().find((definition) => definition.key === 'allergens')
    expect(allergens).toBeDefined()
    if (!allergens) return
    const { unmount } = renderWithIntl(
      <FieldValueView definition={allergens} value={['gluten', 'molluscs']} />,
      { locale: 'en' },
    )
    expect(screen.getByText('Gluten')).toBeTruthy()
    expect(screen.getByText('Molluscs')).toBeTruthy()
    unmount()
    renderWithIntl(<FieldValueView definition={allergens} value={['gluten', 'molluscs']} />, {
      locale: 'bg',
    })
    expect(screen.getByText('Глутен')).toBeTruthy()
    expect(screen.getByText('Мекотели')).toBeTruthy()
  })

  it('draws every field type of the samples through the registry without a type switch', () => {
    const samples = [
      ...itemDefinitions().map((definition) => ({
        definition,
        value: ITEM_SAMPLE_VALUES[definition.key],
      })),
      ...EXTRA_TYPE_SAMPLES,
    ]
    expect(new Set(samples.map((sample) => sample.definition.type))).toEqual(
      new Set(FIELD_TYPE_NAMES),
    )
    for (const { definition, value } of samples) {
      for (const locale of ['bg', 'en'] as const) {
        const { container, unmount } = renderWithIntl(
          <FieldValueView definition={definition} value={value} />,
          { locale },
        )
        expect(container.textContent?.trim(), `${definition.key} in ${locale}`).not.toBe('')
        expect(container.textContent).not.toContain('not valid for this field type')
        unmount()
      }
    }
  })

  it('shows a notice instead of crashing when a stored value is not valid for its type', () => {
    const price = itemDefinitions().find((definition) => definition.key === 'price')
    if (!price) throw new Error('the Item template has a price')
    renderWithIntl(<FieldValueView definition={price} value={12.5} />)
    expect(screen.getByText(/not valid for this field type/)).toBeTruthy()
  })
})
