// Item sheet data for component tests (not part of the app): the real Item fields of the default
// template, with the values and provenance a test asks for.
import { type FieldDefinition, VENUE_MENU_TEMPLATE } from '@restro/core'

import type { ItemSheetData, SheetField } from '@/server/item-sheet/types'

export const ITEM_DEFINITIONS: readonly FieldDefinition[] =
  VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []

/** A field of the item as the server would send it, with `overrides` applied. */
export function sheetField(key: string, overrides: Partial<SheetField> = {}): SheetField {
  const definition = ITEM_DEFINITIONS.find((candidate) => candidate.key === key)
  if (!definition) throw new Error(`no item field ${key}`)
  return {
    key,
    definition,
    value: null,
    provenance: 'none',
    layer: null,
    conflict: false,
    access: { kind: 'edit' },
    canRevert: false,
    canKeep: false,
    barsyValue: null,
    ...overrides,
  }
}

/** The whole sheet: every Item field in template order; `fields` replaces some of them by key. */
export function sheetData(
  overrides: Partial<Omit<ItemSheetData, 'fields'>> & {
    fields?: Readonly<Record<string, Partial<SheetField>>>
  } = {},
): ItemSheetData {
  const { fields: fieldOverrides = {}, ...rest } = overrides
  return {
    itemId: 'nd_0123456789ABCDEFGHIJKL',
    venueId: 'vn_0123456789ABCDEFGHIJKL',
    title: 'Негрони',
    linkedToBarsy: true,
    linkState: 'active',
    revision: 3,
    defaultLocale: 'bg_BG',
    enabledLocales: ['bg_BG', 'en_US'],
    currency: 'EUR',
    timezone: 'Europe/Sofia',
    visible: true,
    sale: { soldOutTonight: false, offSale: null, canMark: true },
    issues: [],
    translations: [],
    image: null,
    ...rest,
    fields: ITEM_DEFINITIONS.map((definition) =>
      sheetField(definition.key, fieldOverrides[definition.key]),
    ),
  }
}
