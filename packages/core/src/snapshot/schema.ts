// The published contract every face reads: `menu-snapshot/1` (doc "Publishing and the snapshot
// contract" → "Snapshot shape"; brief S3-01a). Written as an allowlist: every object is strict
// (an unknown key fails), every id is a prefixed id of the right kind, every record key has a
// pattern, and a final check ties the references together (no dangling id, no unreferenced
// node, no hidden node smuggled in beside the tree). Rule 3: nothing in this shape can hold a
// till's id, an internal field or provenance — there is simply no place for one.
//
// The ids here are plain regex strings, not `idSchema` (a `z.custom`), so the whole schema can
// be exported as JSON Schema for faces.

import { z } from 'zod'

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import { MAX_IMAGE_SIDE } from '../assets'
import { FIELD_TYPE_NAMES, FIELD_VALUE_SCHEMAS, type FieldType } from '../field-types/catalog'
import { LocaleSchema, LocalizedTextSchema } from '../locales'
import { CurrencySchema, MoneySchema } from '../money'
import { TagColorSchema } from '../tags'

/** The value of a snapshot's `schema` key. */
export const SNAPSHOT_SCHEMA = 'menu-snapshot/1'

/** 22 base62 characters: the body of every id `newId` makes. */
const ID_BODY = '[0-9A-Za-z]{22}'

/** Any string shaped like one of our ids (`xx_` + 22 base62 characters). */
export const ID_LIKE_PATTERN = new RegExp(`^[a-z]{2}_${ID_BODY}$`)

function prefixedId(kind: 'sn' | 'nd' | 'vn' | 'as' | 'tg') {
  return z.string().regex(new RegExp(`^${kind}_${ID_BODY}$`), `expected a ${kind}_ id`)
}

/** A snapshot id (`sn_…`). */
export const SnapshotIdSchema = prefixedId('sn')
/** A node id (`nd_…`): menu, section, item, modifier group, option. */
export const NodeIdSchema = prefixedId('nd')
/** A venue id (`vn_…`). */
export const VenueIdSchema = prefixedId('vn')
/** An asset id (`as_…`). */
export const AssetIdSchema = prefixedId('as')
/** A tag id (`tg_…`). */
export const TagIdSchema = prefixedId('tg')

/** A custom field's key: snake_case like every field key, and never shaped like an id. */
const FieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'field keys are snake_case')
  .refine((key) => !ID_LIKE_PATTERN.test(key), 'a field key must not look like an id')

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a SHA-256 in lower-case hex')

/** `#rrggbb`. */
const HexColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb in lower case')

/** Text per locale; a name or title must hold at least one language (R3: never empty). */
const TextSchema = LocalizedTextSchema
const NamedTextSchema = LocalizedTextSchema.refine(
  (text) => Object.keys(text).length > 0,
  'needs text in at least one language',
)

/** The editions a snapshot was resolved with, as the doc lists them. */
const EditionSchema = z
  .string()
  .regex(
    new RegExp(`^(?:master|venue:vn_${ID_BODY}|service:\\d{4}-\\d{2}-\\d{2})$`),
    'expected master, venue:<vn_ id> or service:<date>',
  )

/** The custom-field types a snapshot can carry (`image`, `file`, `reference` stay out for now). */
export const SNAPSHOT_FIELD_TYPES = FIELD_TYPE_NAMES.filter(
  (type): type is Exclude<FieldType, 'image' | 'file' | 'reference'> =>
    type !== 'image' && type !== 'file' && type !== 'reference',
)

/** An item's state in the snapshot; the shell derives `scheduled` and the overlay `sold_out`. */
export const SNAPSHOT_ITEM_STATES = ['available', 'sold_out'] as const

/** How a guest orders an item that is shown (hidden items are not in the snapshot). */
export const SNAPSHOT_ORDER_MODES = ['orderable', 'ask_waiter'] as const

/** The badge the publisher adds: an item first published under 14 days ago. */
export const NEW_BADGE = 'new'

/** Image variant paths: `/a/<as_ id>/w<width>.webp`. */
const VARIANT_PATH_PATTERN = new RegExp(`^/a/(as_${ID_BODY})/w[1-9][0-9]{1,3}\\.webp$`)

const AvailabilitySchema = FIELD_VALUE_SCHEMAS.availability

const HeaderSchema = z.strictObject({
  id: SnapshotIdSchema,
  version: z.int().positive(),
  hash: HashSchema,
  published_at: z.iso.datetime({ offset: true }),
  menu_id: NodeIdSchema,
  venue_id: VenueIdSchema,
  edition: z.array(EditionSchema),
})

const LocalesSchema = z
  .strictObject({ default: LocaleSchema, available: z.array(LocaleSchema).min(1) })
  .refine((locales) => locales.available.includes(locales.default), 'default must be available')
  .refine(
    (locales) => new Set(locales.available).size === locales.available.length,
    'available locales must not repeat',
  )

/** Theme tokens (R13). S3-03 derives the palette from a brand colour; here they pass through. */
export const SnapshotThemeSchema = z.strictObject({
  palette: z.array(HexColourSchema).min(1).max(16),
  font: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/, 'a font family name'),
  radius: z.int().min(0).max(32),
  shadow: z.int().min(0).max(5),
  logo: AssetIdSchema.nullable(),
})

/** Theme tokens of a snapshot. */
export type SnapshotTheme = z.output<typeof SnapshotThemeSchema>

const AssetSchema = z.strictObject({
  w: z.int().min(1).max(MAX_IMAGE_SIDE),
  h: z.int().min(1).max(MAX_IMAGE_SIDE),
  focal: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  alt: TextSchema,
  variants: z.strictObject({
    thumb: z.string().regex(VARIANT_PATH_PATTERN),
    card: z.string().regex(VARIANT_PATH_PATTERN),
    full: z.string().regex(VARIANT_PATH_PATTERN),
  }),
})

const FieldTypeSchema = z.strictObject({
  type: z.enum(SNAPSHOT_FIELD_TYPES),
  label: NamedTextSchema,
  unit: z.string().min(1).max(16).nullable(),
})

const MenuSchema = z.strictObject({
  id: NodeIdSchema,
  title: TextSchema,
  intro: TextSchema,
  availability: AvailabilitySchema.nullable(),
  sections: z.array(NodeIdSchema),
})

const SectionSchema = z.strictObject({
  title: NamedTextSchema,
  description: TextSchema,
  image: AssetIdSchema.nullable(),
  hints: z.strictObject({
    color: HexColourSchema.nullable(),
    icon: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable(),
  }),
  sections: z.array(NodeIdSchema),
  items: z.array(NodeIdSchema),
})

const BadgeSchema = z.union([z.literal(NEW_BADGE), z.enum(DIETARY_LABELS), TagIdSchema])

const ItemSchema = z.strictObject({
  name: NamedTextSchema,
  description: TextSchema,
  price: MoneySchema.nullable(),
  price_from: MoneySchema.nullable(),
  image: AssetIdSchema.nullable(),
  allergens: z.array(z.enum(ALLERGENS)),
  dietary: z.array(z.enum(DIETARY_LABELS)),
  tags: z.array(TagIdSchema),
  portion: FIELD_VALUE_SCHEMAS.measurement.nullable(),
  badges: z.array(BadgeSchema),
  availability: z.strictObject({
    state: z.enum(SNAPSHOT_ITEM_STATES),
    schedule: AvailabilitySchema.nullable(),
  }),
  order_mode: z.enum(SNAPSHOT_ORDER_MODES),
  orderable: z.boolean(),
  modifier_groups: z.array(NodeIdSchema),
  fields: z.record(FieldKeySchema, z.json()),
})

const ModifierGroupSchema = z.strictObject({
  name: NamedTextSchema,
  min: z.int().min(0),
  max: z.int().min(1),
  options: z.array(NodeIdSchema),
})

const OptionSchema = z.strictObject({
  name: NamedTextSchema,
  price_delta: MoneySchema.nullable(),
})

/**
 * A tag of the venue's vocabulary (D60): its name per language and, since S3-06, the colour token
 * the face resolves against the theme. Optional so a snapshot published before tags had colours
 * still passes; the publisher always writes it.
 */
const TagSchema = z.strictObject({ label: NamedTextSchema, color: TagColorSchema.optional() })

const SnapshotShape = z.strictObject({
  schema: z.literal(SNAPSHOT_SCHEMA),
  snapshot: HeaderSchema,
  locales: LocalesSchema,
  currency: CurrencySchema,
  theme: SnapshotThemeSchema,
  assets: z.record(AssetIdSchema, AssetSchema),
  field_types: z.record(FieldKeySchema, FieldTypeSchema),
  menu: MenuSchema,
  sections: z.record(NodeIdSchema, SectionSchema),
  items: z.record(NodeIdSchema, ItemSchema),
  modifier_groups: z.record(NodeIdSchema, ModifierGroupSchema),
  options: z.record(NodeIdSchema, OptionSchema),
  tags: z.record(TagIdSchema, TagSchema),
})

type Shape = z.output<typeof SnapshotShape>
type Path = (string | number)[]

/**
 * The checks no single object can make: every id points at something in the snapshot, every
 * section, item, group, option and asset is reached from the menu (so nothing hidden can sit
 * beside the tree), sections form a tree, money is in the snapshot's currency, and each custom
 * field holds a valid value of its declared type.
 */
function checkReferences(snapshot: Shape, ctx: z.RefinementCtx): void {
  const issue = (path: Path, message: string) => ctx.addIssue({ code: 'custom', path, message })
  const has = (record: object, id: string) => Object.hasOwn(record, id)

  if (snapshot.snapshot.menu_id !== snapshot.menu.id) {
    issue(['snapshot', 'menu_id'], 'must be the menu id')
  }

  const noRepeats = (ids: readonly string[], path: Path) => {
    if (new Set(ids).size !== ids.length) issue(path, 'ids must not repeat')
  }

  // Sections: a tree under the menu, each section reached exactly once.
  const sectionSeen = new Set<string>()
  const queue: { ids: readonly string[]; path: Path }[] = [
    { ids: snapshot.menu.sections, path: ['menu', 'sections'] },
  ]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    noRepeats(next.ids, next.path)
    next.ids.forEach((id, index) => {
      const section = snapshot.sections[id]
      if (section === undefined || !has(snapshot.sections, id)) {
        issue([...next.path, index], 'unknown section')
      } else if (sectionSeen.has(id)) {
        issue([...next.path, index], 'a section appears once in the tree')
      } else {
        sectionSeen.add(id)
        queue.push({ ids: section.sections, path: ['sections', id, 'sections'] })
      }
    })
  }
  for (const id of Object.keys(snapshot.sections)) {
    if (!sectionSeen.has(id)) issue(['sections', id], 'not reached from the menu')
  }

  // Items: placed in at least one section of the tree.
  const itemSeen = new Set<string>()
  for (const id of sectionSeen) {
    const items = snapshot.sections[id]?.items ?? []
    noRepeats(items, ['sections', id, 'items'])
    items.forEach((itemId, index) => {
      if (!has(snapshot.items, itemId)) issue(['sections', id, 'items', index], 'unknown item')
      itemSeen.add(itemId)
    })
  }
  for (const id of Object.keys(snapshot.items)) {
    if (!itemSeen.has(id)) issue(['items', id], 'not placed in any section')
  }

  // Modifier groups and options: each belongs to exactly one parent.
  const groupSeen = new Set<string>()
  for (const [itemId, item] of Object.entries(snapshot.items)) {
    item.modifier_groups.forEach((groupId, index) => {
      const path = ['items', itemId, 'modifier_groups', index]
      if (!has(snapshot.modifier_groups, groupId)) issue(path, 'unknown modifier group')
      else if (groupSeen.has(groupId)) issue(path, 'a modifier group belongs to one item')
      groupSeen.add(groupId)
    })
  }
  for (const id of Object.keys(snapshot.modifier_groups)) {
    if (!groupSeen.has(id)) issue(['modifier_groups', id], 'not used by any item')
  }
  const optionSeen = new Set<string>()
  for (const [groupId, group] of Object.entries(snapshot.modifier_groups)) {
    group.options.forEach((optionId, index) => {
      const path = ['modifier_groups', groupId, 'options', index]
      if (!has(snapshot.options, optionId)) issue(path, 'unknown option')
      else if (optionSeen.has(optionId)) issue(path, 'an option belongs to one group')
      optionSeen.add(optionId)
    })
    if (group.min > group.max) issue(['modifier_groups', groupId, 'min'], 'min must not exceed max')
  }
  for (const id of Object.keys(snapshot.options)) {
    if (!optionSeen.has(id)) issue(['options', id], 'not used by any modifier group')
  }

  // Assets: referenced by an image or the logo; variant paths name the asset itself.
  const assetSeen = new Set<string>()
  const markAsset = (id: string | null, path: Path) => {
    if (id === null) return
    if (!has(snapshot.assets, id)) issue(path, 'unknown asset')
    assetSeen.add(id)
  }
  markAsset(snapshot.theme.logo, ['theme', 'logo'])
  for (const [id, section] of Object.entries(snapshot.sections)) {
    markAsset(section.image, ['sections', id, 'image'])
  }
  for (const [id, item] of Object.entries(snapshot.items)) {
    markAsset(item.image, ['items', id, 'image'])
  }
  for (const [id, asset] of Object.entries(snapshot.assets)) {
    if (!assetSeen.has(id)) issue(['assets', id], 'not used by any image')
    for (const [variant, path] of Object.entries(asset.variants)) {
      if (VARIANT_PATH_PATTERN.exec(path)?.[1] !== id) {
        issue(['assets', id, 'variants', variant], 'a variant path names its own asset')
      }
    }
  }

  // Money in the snapshot's currency.
  const currency = (money: { currency: string } | null, path: Path) => {
    if (money !== null && money.currency !== snapshot.currency) {
      issue(path, 'money must be in the snapshot currency')
    }
  }
  for (const [id, option] of Object.entries(snapshot.options)) {
    currency(option.price_delta, ['options', id, 'price_delta'])
  }

  // Items: tags from the vocabulary, badges consistent, custom fields valid for their type.
  for (const [id, item] of Object.entries(snapshot.items)) {
    currency(item.price, ['items', id, 'price'])
    currency(item.price_from, ['items', id, 'price_from'])
    noRepeats(item.allergens, ['items', id, 'allergens'])
    noRepeats(item.dietary, ['items', id, 'dietary'])
    noRepeats(item.tags, ['items', id, 'tags'])
    noRepeats(item.badges, ['items', id, 'badges'])
    item.tags.forEach((tag, index) => {
      if (!has(snapshot.tags, tag)) issue(['items', id, 'tags', index], 'unknown tag')
    })
    item.badges.forEach((badge, index) => {
      if (badge.startsWith('tg_') && !has(snapshot.tags, badge)) {
        issue(['items', id, 'badges', index], 'unknown tag')
      }
    })
    if (item.orderable && (item.order_mode !== 'orderable' || item.price === null)) {
      issue(['items', id, 'orderable'], 'an orderable item is in order mode orderable and priced')
    }
    for (const [key, value] of Object.entries(item.fields)) {
      const fieldType = snapshot.field_types[key]
      if (fieldType === undefined || !has(snapshot.field_types, key)) {
        issue(['items', id, 'fields', key], 'not a declared field type')
        continue
      }
      if (!FIELD_VALUE_SCHEMAS[fieldType.type].safeParse(value).success) {
        issue(['items', id, 'fields', key], `not a valid ${fieldType.type} value`)
      } else if (fieldType.type === 'money')
        currency(value as { currency: string }, ['items', id, 'fields', key])
    }
  }
}

/** The strict schema of `menu-snapshot/1`. */
export const MenuSnapshotSchema = SnapshotShape.superRefine(checkReferences)

/** A `menu-snapshot/1` document. */
export type MenuSnapshot = z.output<typeof MenuSnapshotSchema>

/** One item of a snapshot. */
export type SnapshotItem = MenuSnapshot['items'][string]

/**
 * The live overlay (`live.json`): sold-out marks of the service edition.
 *
 * Published files change parser-first: loosen the reader, deploy it, then let the producer emit
 * the new field. Inside `menu-snapshot/1` and `live.json` v1, new fields are optional forever.
 *
 * So the top level ignores keys it does not know (a phone that has not been updated still reads
 * a newer file; without this, one new key would fail the parse, the loader would take that for "no
 * overlay" and every sold-out mark would vanish: the less cautious error, A5-F2). `version` and
 * `items` stay strict, and so does each mark: a mark we cannot read is a failed parse, never a
 * guess. The snapshot keeps its strict schema (`MenuSnapshotSchema`): it is immutable and
 * versioned by its `schema` literal, not extended in place.
 */
export const LiveOverlaySchema = z.looseObject({
  version: z.int().positive(),
  items: z.record(NodeIdSchema, z.strictObject({ sold_out: z.literal(true) })),
})

/** A live overlay. */
export type LiveOverlay = z.output<typeof LiveOverlaySchema>

let jsonSchema: Record<string, unknown> | undefined

/**
 * The snapshot schema as JSON Schema (draft 2020-12), for faces and their contract tests. The
 * cross-reference checks of `MenuSnapshotSchema` are not expressible there; faces that need
 * them validate with the Zod schema.
 */
export function menuSnapshotJsonSchema(): Record<string, unknown> {
  jsonSchema ??= z.toJSONSchema(SnapshotShape, { target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >
  return jsonSchema
}
