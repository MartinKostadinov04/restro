import { FIELD_TYPES, FieldDefinitionSchema } from '@restro/core'
import { describe, expect, it } from 'vitest'

import {
  EXTRA_TYPE_SAMPLES,
  ITEM_GROUPS,
  ITEM_SAMPLE_PROVENANCE,
  ITEM_SAMPLE_VALUES,
  itemDefinitions,
} from './samples'

describe('the sample data of /dev/fields', () => {
  it('has a valid sample value for every field of the default template’s Item node', () => {
    const definitions = itemDefinitions()
    expect(definitions.length).toBeGreaterThan(10)
    for (const definition of definitions) {
      const sample = ITEM_SAMPLE_VALUES[definition.key]
      expect(sample, `${definition.key} has a sample`).not.toBeUndefined()
      const verdict = FIELD_TYPES[definition.type].validate(sample, definition)
      expect(verdict, `${definition.key}: ${verdict.ok ? '' : verdict.reason}`).toEqual({
        ok: true,
      })
      expect(
        ITEM_SAMPLE_PROVENANCE[definition.key],
        `${definition.key} has a provenance`,
      ).toBeDefined()
    }
  })

  it('puts every Item field into exactly one group', () => {
    const grouped = ITEM_GROUPS.flatMap((group) => [...group.keys])
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(
      itemDefinitions()
        .map((definition) => definition.key)
        .sort(),
    )
  })

  it('has valid definitions and values for the types the Item does not use', () => {
    for (const { definition, value } of EXTRA_TYPE_SAMPLES) {
      expect(FieldDefinitionSchema.safeParse(definition).success, definition.key).toBe(true)
      expect(FIELD_TYPES[definition.type].validate(value, definition), definition.key).toEqual({
        ok: true,
      })
    }
  })
})
