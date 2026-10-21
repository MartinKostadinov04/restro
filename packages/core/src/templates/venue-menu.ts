// The default template `venue-menu@1`: the doc's "Standard Item fields" with their owners and
// combinators from the ownership matrix, the brief's additions (order_mode, abv, internal_note,
// for_sale, visible), and the Section, Menu, Modifier group and Option fields. Tenants get a copy
// they can extend; this constant itself is frozen.

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import type { FieldDefinition } from '../field-definition'
import type { LocalizedText } from '../locales'
import type { Template } from '../template'

/** An item's ordering mode, set by the venue owner (D29): it can only make an item more cautious. */
export const ORDER_MODES = ['orderable', 'ask_waiter', 'hidden'] as const

/** One of the ordering modes. */
export type OrderMode = (typeof ORDER_MODES)[number]

/**
 * How a section lays out its items on the guest page (D92): a vertical list, or a horizontal row
 * (promotions, top picks: the face's feature strip). Ours on every venue, own and till sections
 * alike; a section that never set it is vertical.
 */
export const SECTION_LAYOUTS = ['vertical', 'horizontal'] as const

/** One section layout. */
export type SectionLayout = (typeof SECTION_LAYOUTS)[number]

/** The layout of a section that has none set. */
export const DEFAULT_SECTION_LAYOUT: SectionLayout = 'vertical'

function label(bg: string, en: string): LocalizedText {
  return { bg_BG: bg, en_US: en }
}

/** The attributes every field states explicitly (ownership above all), plus overridden defaults. */
type Explicit = 'key' | 'type' | 'label' | 'owner' | 'overridable' | 'combinator'
type FieldSpec = Pick<FieldDefinition, Explicit> &
  Partial<Omit<FieldDefinition, Explicit | 'localizable'>>

/** Fills the defaults every field shares (optional, public, not critical, stale → review). */
function field(spec: FieldSpec): FieldDefinition {
  const definition: FieldDefinition = {
    key: spec.key,
    type: spec.type,
    label: spec.label,
    required: spec.required ?? false,
    localizable: spec.type === 'localized_text',
    constraints: spec.constraints ?? {},
    owner: spec.owner,
    overridable: spec.overridable,
    combinator: spec.combinator,
    visibility: spec.visibility ?? 'public',
    critical: spec.critical ?? false,
    stalePolicy: spec.stalePolicy ?? 'review',
  }
  if (spec.options !== undefined) definition.options = spec.options
  if (spec.unit !== undefined) definition.unit = spec.unit
  if (spec.default !== undefined) definition.default = spec.default
  return definition
}

/** Builder-owned, builder value first, never overridden (overrides are for source values). */
const BUILDER = { owner: 'builder', overridable: 'never', combinator: 'builder_first' } as const
/** Till-owned, display override allowed, override → till → manual. */
const TILL_DISPLAY = { owner: 'till', overridable: 'always', combinator: 'source_first' } as const

const itemFields: FieldDefinition[] = [
  field({
    key: 'name',
    type: 'localized_text',
    label: label('Име', 'Name'),
    required: true,
    critical: true,
    ...TILL_DISPLAY,
  }),
  field({
    key: 'description',
    type: 'localized_text',
    label: label('Описание', 'Description'),
    ...BUILDER,
  }),
  field({
    key: 'price',
    type: 'money',
    label: label('Цена', 'Price'),
    required: 'when_orderable',
    constraints: { min_minor: 0 },
    owner: 'till',
    overridable: 'never_when_orderable',
    combinator: 'locked',
    critical: true,
  }),
  field({ key: 'image', type: 'image', label: label('Снимка', 'Image'), ...BUILDER }),
  // Owner: "the till when mapped, else builder" — the till, so builder values go through conflict
  // resolution (stored as overrides). Required but not critical: V4/V5 are warnings (D42).
  field({
    key: 'allergens',
    type: 'enum_set',
    label: label('Алергени', 'Allergens'),
    required: true,
    options: [...ALLERGENS],
    owner: 'till',
    overridable: 'always',
    combinator: 'must_agree',
  }),
  field({
    key: 'dietary',
    type: 'enum_set',
    label: label('Диетични етикети', 'Dietary labels'),
    options: [...DIETARY_LABELS],
    owner: 'builder',
    overridable: 'never',
    combinator: 'union',
  }),
  field({
    key: 'portion',
    type: 'measurement',
    label: label('Порция', 'Portion'),
    ...TILL_DISPLAY,
  }),
  field({
    key: 'abv',
    type: 'number',
    label: label('Алкохолно съдържание', 'ABV'),
    constraints: { min: 0, max: 100 },
    unit: '%',
    ...BUILDER,
  }),
  field({
    key: 'tags',
    type: 'tags',
    label: label('Тагове', 'Tags'),
    owner: 'builder',
    overridable: 'never',
    combinator: 'union',
  }),
  field({
    key: 'availability',
    type: 'availability',
    label: label('График', 'Availability'),
    ...BUILDER,
  }),
  field({
    key: 'internal_note',
    type: 'long_text',
    label: label('Вътрешна бележка', 'Internal note'),
    visibility: 'internal',
    ...BUILDER,
  }),
  field({
    key: 'order_mode',
    type: 'enum',
    label: label('Начин на поръчка', 'Ordering mode'),
    required: true,
    critical: true,
    options: [...ORDER_MODES],
    default: 'orderable',
    ...BUILDER,
  }),
  // The till's for-sale flag (per venue) AND builder sold-out marks; builder layers may only say false.
  field({
    key: 'for_sale',
    type: 'boolean',
    label: label('В продажба', 'For sale'),
    owner: 'till',
    overridable: 'always',
    combinator: 'all_true',
  }),
  // The till's public flag AND builder hiding; builder layers may only say false.
  field({
    key: 'visible',
    type: 'boolean',
    label: label('Видим', 'Visible'),
    owner: 'till',
    overridable: 'always',
    combinator: 'all_true',
  }),
]

const sectionFields: FieldDefinition[] = [
  field({
    key: 'title',
    type: 'localized_text',
    label: label('Заглавие', 'Title'),
    required: true,
    critical: true,
    ...TILL_DISPLAY,
  }),
  field({
    key: 'description',
    type: 'localized_text',
    label: label('Описание', 'Description'),
    ...BUILDER,
  }),
  field({ key: 'image', type: 'image', label: label('Снимка', 'Image'), ...BUILDER }),
  // The doc's display "hints" ({ color, icon }) fit no single vocabulary type: two text fields.
  field({
    key: 'hint_color',
    type: 'short_text',
    label: label('Цвят', 'Colour'),
    constraints: { max_length: 32 },
    ...BUILDER,
  }),
  field({
    key: 'hint_icon',
    type: 'short_text',
    label: label('Икона', 'Icon'),
    constraints: { max_length: 64 },
    ...BUILDER,
  }),
  // A layout hint like the two above (D92): the snapshot's `hints.layout`, which the face draws.
  field({
    key: 'layout',
    type: 'enum',
    label: label('Подредба', 'Layout'),
    options: [...SECTION_LAYOUTS],
    default: DEFAULT_SECTION_LAYOUT,
    ...BUILDER,
  }),
]

const menuFields: FieldDefinition[] = [
  field({
    key: 'title',
    type: 'localized_text',
    label: label('Заглавие', 'Title'),
    required: true,
    ...BUILDER,
  }),
  field({ key: 'intro', type: 'localized_text', label: label('Въведение', 'Intro'), ...BUILDER }),
  field({
    key: 'availability',
    type: 'availability',
    label: label('График', 'Availability'),
    ...BUILDER,
  }),
]

// Min and max decide what a guest must choose before the till accepts the order, so they follow
// the till and cannot be overridden; builder-defined groups set them in the manual layer.
const TILL_STRICT = { owner: 'till', overridable: 'never', combinator: 'source_first' } as const

const modifierGroupFields: FieldDefinition[] = [
  field({
    key: 'name',
    type: 'localized_text',
    label: label('Име', 'Name'),
    required: true,
    critical: true,
    ...TILL_DISPLAY,
  }),
  field({
    key: 'min',
    type: 'number',
    label: label('Минимален избор', 'Minimum choices'),
    required: true,
    critical: true,
    constraints: { integer: true, min: 0 },
    ...TILL_STRICT,
  }),
  field({
    key: 'max',
    type: 'number',
    label: label('Максимален избор', 'Maximum choices'),
    required: true,
    critical: true,
    constraints: { integer: true, min: 1 },
    ...TILL_STRICT,
  }),
]

const optionFields: FieldDefinition[] = [
  field({
    key: 'name',
    type: 'localized_text',
    label: label('Име', 'Name'),
    required: true,
    critical: true,
    ...TILL_DISPLAY,
  }),
  // May be 0 (a free choice); never negative (V2).
  field({
    key: 'price_delta',
    type: 'money',
    label: label('Добавка към цената', 'Price change'),
    constraints: { min_minor: 0 },
    owner: 'till',
    overridable: 'never_when_orderable',
    combinator: 'locked',
    critical: true,
  }),
]

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) deepFreeze(member)
    Object.freeze(value)
  }
  return value
}

/**
 * The default template `venue-menu@1` (frozen). Specials are not in it yet: the doc defines no
 * Special fields.
 */
export const VENUE_MENU_TEMPLATE: Template = deepFreeze({
  key: 'venue-menu',
  version: 1,
  name: label('Меню на заведение', 'Venue menu'),
  nodeTypes: {
    menu: { fields: menuFields },
    section: { fields: sectionFields },
    item: { fields: itemFields },
    modifier_group: { fields: modifierGroupFields },
    option: { fields: optionFields },
  },
})
