// buildSnapshot(): one resolved menu for one venue → `menu-snapshot/1` (brief S3-01a). Pure and
// deterministic: no clock, no randomness, no I/O; the order comes from the resolver (sections
// tree, `itemIds`, groups, options) and set-like values are put in their vocabulary's order, so
// the same content always gives the same JSON and the same hash.
//
// It reads only what a guest may see: resolved values of fields whose definition is `public`,
// the computed `orderable` / `priceFrom` / `badges`, and the context. Never provenance, layers,
// issues, override bases, review state or source information: the resolver's output carries
// them beside the values, and nothing here copies them. Hidden items, sections, groups and
// options are left out.

import { ALLERGENS, DIETARY_LABELS } from '../allergens'
import type { FieldDefinition } from '../field-definition'
import {
  FIELD_VALUE_SCHEMAS,
  type FieldType,
  type FieldValue,
  type FieldValueOf,
} from '../field-types/catalog'
import type { DesignValues } from '../design/contract'
import { canonicalJson, sha256Hex } from '../hash'
import type { AssetId, NodeId, SnapshotId, TagId, VenueId } from '../ids'
import type { Locale, LocalizedText } from '../locales'
import { type Currency, type Money, MoneySchema } from '../money'
import type { NodeType } from '../node-types'
import type {
  ResolvedFields,
  ResolvedItem,
  ResolvedMenu,
  ResolvedModifierGroup,
  ResolvedOption,
  ResolvedSection,
} from '../resolve/types'
import type { TagColor } from '../tags'
import type { Template } from '../template'
import {
  DEFAULT_SECTION_LAYOUT,
  SECTION_LAYOUTS,
  type SectionLayout,
} from '../templates/venue-menu'
import { DEFAULT_PALETTE, PALETTE_STEPS, paletteRoles } from '../theme/derive'
import { canonicalFeatures, DEFAULT_GUEST_FEATURES, type GuestFeatures } from '../theme/presentation'
import { parseSnapshot } from './errors'
import {
  type MenuSnapshot,
  NEW_BADGE,
  SNAPSHOT_FIELD_TYPES,
  SNAPSHOT_SCHEMA,
  type SnapshotItem,
  type SnapshotLayout,
  type SnapshotTheme,
} from './schema'

/** The image variants a face can ask for, and the width each is made at (S3-01b makes them). */
export const ASSET_VARIANT_WIDTHS = { thumb: 320, card: 640, full: 1280 } as const

/** Which variant files exist for one asset: the width of the file each variant uses. */
export interface AssetVariantWidths {
  readonly thumb: number
  readonly card: number
  readonly full: number
}

/** What the builder needs to know about one stored image (its size and its variant files). */
export interface SnapshotAssetInput {
  readonly w: number
  readonly h: number
  readonly variants: AssetVariantWidths
}

/** One entry of the venue's tag vocabulary (D60): the venue's non-archived tags, from S3-06. */
export interface TagVocabularyEntry {
  readonly label: LocalizedText
  /** The colour token the face resolves against the theme; left out of the snapshot when absent. */
  readonly color?: TagColor
}

/** Everything `buildSnapshot` needs beside the resolved menu. */
export interface SnapshotContext {
  /** The template the menu was resolved with: only its `public` fields are read. */
  readonly template: Template
  readonly snapshotId: SnapshotId
  readonly version: number
  /** ISO 8601 with offset. Part of the header, so not part of the hash. */
  readonly publishedAt: string
  readonly menuId: NodeId
  readonly venueId: VenueId
  /** As the doc lists them: `master`, `venue:<vn_ id>`, `service:<date>`. */
  readonly edition: readonly string[]
  readonly locales: { readonly default: Locale; readonly available: readonly Locale[] }
  readonly currency: Currency
  /** The venue's theme tokens; null or absent = `DEFAULT_THEME`. */
  readonly theme?: SnapshotTheme | null
  /** Images whose variant files exist; an image not listed here counts as no image. */
  readonly assets: Readonly<Record<AssetId, SnapshotAssetInput>>
  readonly tagVocabulary: Readonly<Record<TagId, TagVocabularyEntry>>
  /** The venue's guest services (D71); null or absent = `DEFAULT_GUEST_FEATURES`. */
  readonly features?: GuestFeatures | null
  /**
   * The venue's design values (D129): written as the snapshot's `design` block, and its Layout and
   * Guest switch as the `layout` (`designLayoutOf`). Null or absent: no `design` block and
   * `DEFAULT_MENU_LAYOUT` (the publisher always passes one).
   */
  readonly design?: DesignValues | null
  /** The menu's header name (D92, `menus.name`); null, absent or blank = none set. */
  readonly menuName?: string | null
  /** The venue's display name (`venues.name`): the heading of a menu with no name and no title. */
  readonly venueName?: string | null
}

/**
 * The layout of a snapshot built without a design (D92): the look menus had before the layout
 * became a setting (the Editorial Market's old option defaults), two columns, and guests may
 * switch it. The publisher always has a design, so only a builder test meets it.
 */
export const DEFAULT_MENU_LAYOUT: SnapshotLayout = Object.freeze({
  default: 'two',
  guest_switch: true,
})

/** The snapshot's `layout` of a design (D129): the Items page's Layout and Guest switch. */
export function designLayoutOf(design: DesignValues): SnapshotLayout {
  return { default: design.items.layout, guest_switch: design.items.guest_switch === 'on' }
}

/** A fresh copy of a design's values, page by page (the snapshot never shares the caller's objects). */
function designBlock(design: DesignValues): DesignValues {
  return Object.fromEntries(
    Object.entries(design).map(([page, values]) => [page, { ...values }]),
  ) as DesignValues
}

/** A stored section layout, or the default when the value is not one. */
function sectionLayoutOf(value: unknown): SectionLayout {
  return SECTION_LAYOUTS.find((layout) => layout === value) ?? DEFAULT_SECTION_LAYOUT
}

const DEFAULT_ROLES = paletteRoles(DEFAULT_PALETTE)

/**
 * The theme a venue gets until it sets its own (S3-03 derives a palette from a brand colour): the
 * neutral default palette, its roles through the v1 path (`semanticColours` /
 * `semanticColoursDark`, exactly what the shell derives from that palette), and `auto` scheme.
 */
export const DEFAULT_THEME: SnapshotTheme = Object.freeze({
  palette: Object.freeze(PALETTE_STEPS.map((step) => DEFAULT_PALETTE[step])) as string[],
  font: 'Inter',
  radius: 8,
  shadow: 1,
  logo: null,
  roles: Object.freeze({
    light: Object.freeze(DEFAULT_ROLES.light),
    dark: Object.freeze(DEFAULT_ROLES.dark),
  }),
  scheme: 'auto',
})

/**
 * Item fields with a slot of their own in the snapshot (doc "Standard Item fields"). `for_sale`
 * and `visible` are read only through the item's state and visibility. Every other public item
 * field is a custom field and goes into `fields` (declared in `field_types`).
 */
const STANDARD_ITEM_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'price',
  'image',
  'allergens',
  'dietary',
  'portion',
  'tags',
  'availability',
  'order_mode',
  'payment_mode',
  'for_sale',
  'visible',
])

const SNAPSHOT_FIELD_TYPE_SET: ReadonlySet<string> = new Set(SNAPSHOT_FIELD_TYPES)

/** SHA-256 of the canonical JSON of the snapshot without its `snapshot` header. */
export function snapshotContentHash(snapshot: Omit<MenuSnapshot, 'snapshot'>): string {
  const { snapshot: _header, ...content } = snapshot as MenuSnapshot
  return sha256Hex(canonicalJson(content))
}

/** The variant path a face loads: `/a/<as_ id>/w<width>.webp`. */
export function assetVariantPath(assetId: AssetId, width: number): string {
  return `/a/${assetId}/w${width}.webp`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return isPlainObject(value) && Object.keys(value).length === 0
}

/** A canonical value of one field type, or null when the stored value is not one. */
function valueAs<K extends FieldType>(type: K, value: unknown): FieldValueOf<K> | null {
  if (value === null || value === undefined) return null
  const parsed = FIELD_VALUE_SCHEMAS[type].safeParse(value)
  return parsed.success ? (parsed.data as FieldValueOf<K>) : null
}

/** Codes of a set-valued field kept in the vocabulary's own order (set order carries nothing). */
function inVocabularyOrder<T extends string>(value: unknown, vocabulary: readonly T[]): T[] {
  if (!Array.isArray(value)) return []
  const present = new Set(value)
  return vocabulary.filter((code) => present.has(code))
}

function compareText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Turns one resolved menu into its snapshot (see the file header). */
export function buildSnapshot(resolved: ResolvedMenu, ctx: SnapshotContext): MenuSnapshot {
  const definitions = new Map<NodeType, Map<string, FieldDefinition>>()
  for (const [type, spec] of Object.entries(ctx.template.nodeTypes) as [
    NodeType,
    { fields: FieldDefinition[] },
  ][]) {
    definitions.set(
      type,
      new Map(
        spec.fields.filter((def) => def.visibility === 'public').map((def) => [def.key, def]),
      ),
    )
  }
  /** A resolved value, only when the template declares the field public for this node type. */
  const read = (type: NodeType, fields: ResolvedFields, key: string): FieldValue | null =>
    definitions.get(type)?.has(key) === true ? (fields[key]?.value ?? null) : null
  const text = (type: NodeType, fields: ResolvedFields, key: string): LocalizedText =>
    valueAs('localized_text', read(type, fields, key)) ?? {}
  const money = (value: unknown): Money | null => {
    const parsed = MoneySchema.safeParse(value)
    return parsed.success ? parsed.data : null
  }

  const customItemFields = [...(definitions.get('item')?.values() ?? [])].filter(
    (def) => !STANDARD_ITEM_FIELDS.has(def.key) && SNAPSHOT_FIELD_TYPE_SET.has(def.type),
  )

  // Images: an asset is included once, with the alt text and focal point of its first use in
  // snapshot order (menu, sections depth-first, their items, the logo last).
  const assets: MenuSnapshot['assets'] = {}
  const imageRef = (value: unknown): AssetId | null => {
    const image = valueAs('image', value)
    if (image === null) return null
    const id = image.asset_id as AssetId
    const input = Object.hasOwn(ctx.assets, id) ? ctx.assets[id] : undefined
    if (input === undefined) return null
    if (!Object.hasOwn(assets, id)) {
      assets[id] = {
        w: input.w,
        h: input.h,
        focal: image.focal === null ? null : { x: image.focal.x, y: image.focal.y },
        alt: image.alt,
        variants: {
          thumb: assetVariantPath(id, input.variants.thumb),
          card: assetVariantPath(id, input.variants.card),
          full: assetVariantPath(id, input.variants.full),
        },
      }
    }
    return id
  }

  const tagIds = new Set(Object.keys(ctx.tagVocabulary))
  const sections: MenuSnapshot['sections'] = {}
  const items: MenuSnapshot['items'] = {}
  const groups: MenuSnapshot['modifier_groups'] = {}
  const options: MenuSnapshot['options'] = {}

  const addOption = (option: ResolvedOption | undefined): NodeId | null => {
    if (option === undefined || !option.visible) return null
    if (Object.hasOwn(options, option.id)) return option.id
    const name = text('option', option.fields, 'name')
    if (Object.keys(name).length === 0) return null
    options[option.id] = {
      name,
      price_delta: money(read('option', option.fields, 'price_delta')),
    }
    return option.id
  }

  const addGroup = (group: ResolvedModifierGroup | undefined): NodeId | null => {
    if (group === undefined || !group.visible) return null
    if (Object.hasOwn(groups, group.id)) return group.id
    const name = text('modifier_group', group.fields, 'name')
    const min = read('modifier_group', group.fields, 'min')
    const max = read('modifier_group', group.fields, 'max')
    if (Object.keys(name).length === 0) return null
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return null
    if ((min as number) < 0 || (max as number) < 1 || (min as number) > (max as number)) {
      return null
    }
    const optionIds = group.optionIds
      .map((id) => addOption(resolved.options[id]))
      .filter((id): id is NodeId => id !== null)
    // A group with nothing to choose shows nothing; the resolver already counted it for
    // `orderable` (a required group without options makes its item not orderable).
    if (optionIds.length === 0) return null
    groups[group.id] = { name, min: min as number, max: max as number, options: optionIds }
    return group.id
  }

  const addItem = (item: ResolvedItem | undefined): NodeId | null => {
    if (item === undefined || !item.visible) return null
    if (Object.hasOwn(items, item.id)) return item.id
    const fields = item.fields
    const name = text('item', fields, 'name')
    if (Object.keys(name).length === 0) return null
    const orderModeValue = read('item', fields, 'order_mode')
    // Visible items are `orderable` or `ask_waiter`; anything else is shown the cautious way.
    const orderMode: SnapshotItem['order_mode'] =
      orderModeValue === 'orderable' ? 'orderable' : 'ask_waiter'
    const paymentMode = read('item', fields, 'payment_mode')
    const soldOut = read('item', fields, 'for_sale') === false
    const dietary = inVocabularyOrder(read('item', fields, 'dietary'), DIETARY_LABELS)
    const tagValue = read('item', fields, 'tags')
    const tags = (Array.isArray(tagValue) ? tagValue : [])
      .filter((tag): tag is TagId => typeof tag === 'string' && tagIds.has(tag))
      .sort(compareText)
    const custom: Record<string, FieldValue> = {}
    for (const def of customItemFields) {
      const value = read('item', fields, def.key)
      if (isEmptyValue(value)) continue
      const parsed = FIELD_VALUE_SCHEMAS[def.type].safeParse(value)
      if (parsed.success) custom[def.key] = parsed.data as FieldValue
    }
    const entry: SnapshotItem = {
      name,
      description: text('item', fields, 'description'),
      price: money(read('item', fields, 'price')),
      price_from: money(item.computed.priceFrom),
      image: imageRef(read('item', fields, 'image')),
      allergens: inVocabularyOrder(read('item', fields, 'allergens'), ALLERGENS),
      dietary,
      tags,
      portion: valueAs('measurement', read('item', fields, 'portion')),
      // Only "new": dietary labels and tags have their own slots, so a face never shows them
      // twice (lead's decision 10-10, doc example `"badges": ["new"]`).
      badges: item.computed.badges.includes(NEW_BADGE) ? [NEW_BADGE] : [],
      availability: {
        state: soldOut ? 'sold_out' : 'available',
        schedule: valueAs('availability', read('item', fields, 'availability')),
      },
      order_mode: orderMode,
      orderable: item.computed.orderable === true && orderMode === 'orderable' && !soldOut,
      modifier_groups: [],
      fields: custom,
      // D113: written only when the item sets its own; without one it takes the venue's default.
      ...(paymentMode === 'on_bill' || paymentMode === 'pay_first'
        ? { payment_mode: paymentMode }
        : {}),
    }
    // Registered before its groups so a repeated placement finds it; groups fill in after.
    items[item.id] = entry
    entry.modifier_groups = item.modifierGroupIds
      .map((id) => addGroup(resolved.modifierGroups[id]))
      .filter((id): id is NodeId => id !== null)
    return item.id
  }

  const addSection = (section: ResolvedSection): NodeId | null => {
    if (!section.visible || Object.hasOwn(sections, section.id)) return null
    const title = text('section', section.fields, 'title')
    if (Object.keys(title).length === 0) return null
    const image = imageRef(read('section', section.fields, 'image'))
    const childIds = section.children.map(addSection).filter((id): id is NodeId => id !== null)
    const itemIds = [
      ...new Set(
        section.itemIds
          .map((id) => addItem(resolved.items[id]))
          .filter((id): id is NodeId => id !== null),
      ),
    ]
    // V9: a section with nothing to show is left out (the resolver hides those already).
    if (childIds.length === 0 && itemIds.length === 0) return null
    const color = read('section', section.fields, 'hint_color')
    const icon = read('section', section.fields, 'hint_icon')
    sections[section.id] = {
      title,
      description: text('section', section.fields, 'description'),
      image,
      hints: {
        color:
          typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null,
        icon: typeof icon === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(icon) ? icon : null,
        layout: sectionLayoutOf(read('section', section.fields, 'layout')),
      },
      sections: childIds,
      items: itemIds,
    }
    return section.id
  }

  const menuSections = resolved.sections.map(addSection).filter((id): id is NodeId => id !== null)

  const theme = ctx.theme ?? DEFAULT_THEME
  const logo = theme.logo === null ? null : imageRef({ asset_id: theme.logo, alt: {}, focal: null })

  const fieldTypes: MenuSnapshot['field_types'] = {}
  for (const def of customItemFields) {
    fieldTypes[def.key] = {
      type: def.type as MenuSnapshot['field_types'][string]['type'],
      label: def.label,
      unit: def.unit ?? null,
    }
  }

  const tags: MenuSnapshot['tags'] = {}
  for (const id of [...tagIds].sort(compareText)) {
    const entry = ctx.tagVocabulary[id as TagId]
    if (entry !== undefined) {
      tags[id] =
        entry.color === undefined
          ? { label: entry.label }
          : { label: entry.label, color: entry.color }
    }
  }

  // Features always (the defaults: filters on, every service off), with the request kinds in
  // vocabulary order. The design and the layout from it whenever the publisher passes one; no
  // `presentation` any more (D129: the design record replaced it).
  const features = canonicalFeatures(ctx.features ?? DEFAULT_GUEST_FEATURES)
  const design = ctx.design ?? null
  const layout = design === null ? DEFAULT_MENU_LAYOUT : designLayoutOf(design)

  // The guest heading (D92): the menu's header name, else the document's title, else the venue's
  // display name. A plain name is one text, put in the main language; the shell falls back to it.
  const inMainLanguage = (name: string | null | undefined): LocalizedText | null => {
    const trimmed = name?.trim() ?? ''
    return trimmed === '' ? null : { [ctx.locales.default]: trimmed }
  }
  const documentTitle = text('menu', resolved.menu.fields, 'title')
  const title =
    inMainLanguage(ctx.menuName) ??
    (Object.keys(documentTitle).length === 0 ? null : documentTitle) ??
    inMainLanguage(ctx.venueName) ??
    {}

  const content: Omit<MenuSnapshot, 'snapshot'> = {
    schema: SNAPSHOT_SCHEMA,
    locales: { default: ctx.locales.default, available: [...ctx.locales.available] },
    currency: ctx.currency,
    theme: {
      palette: [...theme.palette],
      font: theme.font,
      radius: theme.radius,
      shadow: theme.shadow,
      logo,
      ...(theme.roles === undefined
        ? {}
        : { roles: { light: { ...theme.roles.light }, dark: { ...theme.roles.dark } } }),
      ...(theme.scheme === undefined ? {} : { scheme: theme.scheme }),
    },
    assets,
    field_types: fieldTypes,
    menu: {
      id: resolved.menu.id,
      title,
      intro: text('menu', resolved.menu.fields, 'intro'),
      availability: valueAs('availability', read('menu', resolved.menu.fields, 'availability')),
      sections: menuSections,
    },
    sections,
    items,
    modifier_groups: groups,
    options,
    tags,
    features: {
      filters: features.filters,
      call_waiter: {
        enabled: features.call_waiter.enabled,
        kinds: [...features.call_waiter.kinds],
      },
      bill: features.bill,
      ordering: features.ordering,
      pay: features.pay,
    },
    layout: { default: layout.default, guest_switch: layout.guest_switch },
    ...(design === null ? {} : { design: designBlock(design) }),
  }

  const { schema, ...rest } = content
  const snapshot: MenuSnapshot = {
    schema,
    snapshot: {
      id: ctx.snapshotId,
      version: ctx.version,
      hash: snapshotContentHash(content),
      published_at: ctx.publishedAt,
      menu_id: ctx.menuId,
      venue_id: ctx.venueId,
      edition: [...ctx.edition],
    },
    ...rest,
  }
  return parseSnapshot(snapshot)
}
