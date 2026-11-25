import { describe, expect, it } from 'vitest'

import * as core from './index'

describe('@restro/core public surface', () => {
  it('exports every interface of brief S1-02', () => {
    const expected = [
      // 1-2 vocabulary
      'LOCALES',
      'LocaleSchema',
      'LocalizedTextSchema',
      'ALLERGENS',
      'DIETARY_LABELS',
      // 3-4 field types and the registry contract
      'FIELD_TYPE_NAMES',
      'FIELD_VALUE_SCHEMAS',
      'FIELD_CONSTRAINT_SCHEMAS',
      'MEASUREMENT_UNITS',
      'FIELD_TYPES',
      // 5 field definitions
      'FieldDefinitionSchema',
      // 6 node types
      'NODE_TYPES',
      'NODE_TYPE_SPECS',
      'canNest',
      // 7-8 templates
      'TemplateSchema',
      'parseTemplate',
      'RESERVED_FIELD_KEYS',
      'VENUE_MENU_TEMPLATE',
      'ORDER_MODES',
      'PAYMENT_MODES',
      // 9 change sets and write validation
      'ChangeSetSchema',
      'FieldWriteSchema',
      'StructuralOpSchema',
      'NodeRefSchema',
      'parseChangeSet',
      'validateWrite',
      'layerAllowed',
      // 10 money
      'decimalToMinor',
      'minorToDecimal',
      'formatMoney',
      'MoneySchema',
      // 11 ids
      'newId',
      'isId',
      // 12 sort keys
      'sortKeyBetween',
      'sortKeysBetween',
    ]
    const exported = Object.keys(core)
    for (const name of expected) expect(exported, name).toContain(name)
  })

  it('exports the rule-6 conclusion, and no sealing: that needs node:crypto (@restro/core/seal)', () => {
    const exported = Object.keys(core)
    expect(exported).toEqual(expect.arrayContaining(['concludeFullPull', 'LINK_TRANSITIONS']))
    for (const name of [
      'sealSecret',
      'openSecret',
      'sealBarsyCredentials',
      'openBarsyCredentials',
    ]) {
      expect(exported, name).not.toContain(name)
    }
  })

  it('lists the 11 barsy locales, the 14 EU allergens and the 17 field types', () => {
    expect(core.LOCALES).toEqual([
      'bg_BG',
      'en_US',
      'de_DE',
      'es_ES',
      'fr_FR',
      'it_IT',
      'ro_RO',
      'ru_RU',
      'sr_RS',
      'el_GR',
      'tr_TR',
    ])
    expect(core.ALLERGENS).toHaveLength(14)
    expect(core.FIELD_TYPE_NAMES).toHaveLength(17)
    expect(core.isLocale('bg_BG') && !core.isLocale('bg')).toBe(true)
    expect(core.isAllergen('sulphites') && !core.isAllergen('sulfites')).toBe(true)
    expect(core.localeToBcp47('sr_RS')).toBe('sr-RS')
  })
})
