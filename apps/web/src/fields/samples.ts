// Sample data for the development preview (/dev/fields): one value for every field of the default
// template's Item node, and a synthetic field for each of the six types the Item does not use,
// so that all 17 field types can be seen. Every value is valid for its definition
// (samples.test.ts proves it with core's own validation).
import type { FieldDefinition, FieldType } from '@restro/core'
import { CONNECTOR_LABELS, INTEGRATION_KINDS, VENUE_MENU_TEMPLATE } from '@restro/core'

import type { Provenance } from './types'

/** The till name the preview's "From {source}" badges show: the first connector kind's. */
export const SAMPLE_TILL_LABEL: string =
  INTEGRATION_KINDS.map((kind) => CONNECTOR_LABELS[kind])[0] ?? ''

const ASSET_ID = 'as_4fK9zQ2mX7pL0aBcDeFgHi'
const NODE_ID = 'nd_7Jq2LmN8vXc4RtYz0bPaSd'

/** A sample value per field key of the Item node of `venue-menu@1`. */
export const ITEM_SAMPLE_VALUES: Readonly<Record<string, unknown>> = {
  name: { bg_BG: 'Негрони', en_US: 'Negroni' },
  description: {
    bg_BG: 'Джин, Кампари и сладък вермут, сервиран върху лед с резен портокал.',
    en_US: 'Gin, Campari and sweet vermouth, served over ice with an orange slice.',
  },
  price: { amount_minor: 1250, currency: 'EUR' },
  image: {
    asset_id: ASSET_ID,
    alt: { bg_BG: 'Чаша Негрони с портокал', en_US: 'A glass of Negroni with orange' },
    focal: { x: 0.5, y: 0.4 },
  },
  allergens: ['sulphites'],
  dietary: ['vegan', 'gluten_free'],
  portion: { value: 80, unit: 'ml' },
  abv: 24,
  tags: ['signature', 'classic'],
  availability: {
    timezone: 'Europe/Sofia',
    rules: [{ days: [5, 6], from: '22:00', to: '04:00' }],
  },
  internal_note: 'Поръчвайте Кампари всеки понеделник.\nПортокалови кори в хладилника.',
  order_mode: 'orderable',
  for_sale: true,
  visible: true,
}

/** Where each Item field came from, for the provenance badge (an illustration, not real layers). */
export const ITEM_SAMPLE_PROVENANCE: Readonly<Record<string, Provenance>> = {
  name: 'till',
  description: 'owned',
  price: 'till',
  image: 'owned',
  allergens: 'overridden',
  dietary: 'owned',
  portion: 'till',
  abv: 'owned',
  tags: 'owned',
  availability: 'owned',
  internal_note: 'owned',
  order_mode: 'owned',
  for_sale: 'till',
  visible: 'stale',
}

/** The groups the preview divides the Item's rows into: the item sheet's own (./item-groups). */
export { ITEM_GROUPS } from './item-groups'

/** The definitions of the default template's Item node, in the template's order. */
export function itemDefinitions(): readonly FieldDefinition[] {
  return VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []
}

function synthetic(type: FieldType, key: string, bg: string, en: string): FieldDefinition {
  return {
    key,
    type,
    label: { bg_BG: bg, en_US: en },
    required: false,
    localizable: false,
    constraints: {},
    owner: 'builder',
    overridable: 'never',
    combinator: 'builder_first',
    visibility: 'public',
    critical: false,
    stalePolicy: 'review',
  }
}

/** One field for each type the Item node does not use, with a sample value. */
export const EXTRA_TYPE_SAMPLES: readonly { definition: FieldDefinition; value: unknown }[] = [
  {
    definition: synthetic('short_text', 'sample_short_text', 'Кратък текст', 'Short text'),
    value: 'Signature',
  },
  {
    definition: synthetic('date', 'sample_date', 'Дата', 'Date'),
    value: '2026-12-31',
  },
  {
    definition: synthetic('datetime', 'sample_datetime', 'Дата и час', 'Date and time'),
    value: '2026-12-31T23:00:00+02:00',
  },
  {
    definition: synthetic('range', 'sample_range', 'Диапазон', 'Range'),
    value: { start: 0, end: 3, unit: null, stops: [1, 2] },
  },
  {
    definition: synthetic('file', 'sample_file', 'Файл', 'File'),
    value: { asset_id: ASSET_ID, filename: 'allergens.pdf', size: 182044 },
  },
  {
    definition: synthetic('reference', 'sample_reference', 'Препратка', 'Reference'),
    value: { node_id: NODE_ID },
  },
]
