// The composer's view model: a plain, serialisable picture of one menu for the client component
// (server component -> client component, U4). Built on the server from the loaded document and
// its resolution; nothing in it is an external id (rule 3), a layer value the composer may not show,
// or a function. It is normalised (sections and items by id, ordered id lists) because every
// drag changes one list and the reducer (./reducer.ts) rewrites only that list.
//
// Pure: no I/O, no clock. The server builds it (./composer-tab.tsx); tests build it from small
// hand-made documents.

import {
  type IssueCode,
  type IssueSeverity,
  isId,
  isTillSource,
  type Locale,
  type LocalizedText,
  type MenuDocument,
  type Money,
  type NodeId,
  type OffSaleBy,
  type ResolvedField,
  type ResolvedMenu,
  type ResolvedSection,
  SECTION_LAYOUTS,
  type SectionLayout,
  saleStateOf,
  type Tag,
  type TagColor,
  type TagId,
} from '@restro/core'

import { pickLocalized } from '@/fields/localized'
import { tillTextShown } from '@/fields/name-fallback'

/** One finding of the resolver about a node, for the Issues badge and its list. */
export interface ComposerIssue {
  readonly code: IssueCode
  readonly severity: IssueSeverity
  readonly fieldKey?: string
  readonly locale?: Locale
}

/** Where a node's content comes from: mirrored from the till, or made here (display only). */
export type ComposerOrigin = 'till' | 'owned'

/** A section as the composer shows it. */
export interface ComposerSection {
  readonly id: NodeId
  /** `null` = directly under the menu. */
  readonly parentId: NodeId | null
  /** Title in the interface language ('' when the section has no title). */
  readonly title: string
  readonly origin: ComposerOrigin
  /** The builder hid it (`status = hidden`); hiding a section never touches the till. */
  readonly hidden: boolean
  /** Guests would see it (it and its parents are shown and it holds a shown item). */
  readonly shown: boolean
  readonly sortKey: string
  /** Child sections in order. */
  readonly childIds: readonly NodeId[]
  readonly issues: readonly ComposerIssue[]
  /** The title shown is the till's own name: it has no public one (D75). Warns; never blocks. */
  readonly nameFromTill: boolean
  /**
   * How guests see its items (D92): a vertical list, or a horizontal row (the guest page's strip).
   * Ours on every venue, set in the composer.
   */
  readonly layout: SectionLayout
}

/** Why an item is not shown to guests, as far as the composer can tell and act on. */
export type ItemHiddenBy =
  /** The till hides it: the composer cannot show it (rule 5). */
  | 'till'
  /** The builder's hide flag (`visible = false` in the manual layer): showing clears it. */
  | 'builder'
  /** The sync hid a new till item for review (setting `publish.new_items = hold`): showing clears it. */
  | 'new_from_till'
  /** The item's status is `hidden` (held back): showing makes it active. */
  | 'status'
  /** Another layer or setting hides it (an edition, the ordering mode): not changed here. */
  | 'other'

/**
 * Why an item is off sale, when something other than a manager's "sold out tonight" mark says so
 * (core's `OffSaleBy`): `till` is the till's own flag, `other` another layer or edition. The
 * composer cannot put either back on sale (rule 5).
 */
export type ItemOffSale = OffSaleBy

/** An item as the composer shows it. */
export interface ComposerItem {
  readonly id: NodeId
  /** Name in the interface language ('' when it has none). */
  readonly name: string
  readonly price: Money | null
  readonly origin: ComposerOrigin
  readonly hiddenBy: ItemHiddenBy | null
  /** Guests would see it (resolver: shown, and placed in a shown section). */
  readonly shown: boolean
  readonly issues: readonly ComposerIssue[]
  /** The tag ids the item holds (the union of its layers); resolve them with `ComposerView.tags`. */
  readonly tags: readonly TagId[]
  /** The dietary label codes of the fixed list (`vegan`, `gluten_free`, …). */
  readonly dietary: readonly string[]
  /**
   * A manager marked it sold out tonight (`for_sale = false` in the current service edition,
   * D46) and nothing else takes it off sale. It lapses by itself when the service day ends.
   */
  readonly soldOutTonight: boolean
  /** Off sale for another reason (see `ItemOffSale`): ours can only add caution, never undo it. */
  readonly offSale: ItemOffSale | null
  /** The name shown is the till's own name: it has no public one (D75). Warns; never blocks. */
  readonly nameFromTill: boolean
  /**
   * "Overrides to review" (V12): the fields whose override the till's value has outgrown since it
   * was made (`stale_override`), waiting for a person to keep ours or take the till's. Empty = none.
   */
  readonly reviewFields: readonly string[]
}

/** A venue tag as the composer shows and edits it (D60). */
export interface ComposerTag {
  readonly id: TagId
  /** The name in the interface language ('' never: falls back to any language there is). */
  readonly name: string
  /** The name per language, for the edit form. */
  readonly label: LocalizedText
  readonly color: TagColor
  /** Archived tags are hidden from pickers; the Tags panel lists them to restore. */
  readonly archived: boolean
}

/** An item's place in a section. */
export interface ComposerPlacement {
  readonly itemId: NodeId
  readonly sortKey: string
}

/** The whole picture. */
export interface ComposerView {
  readonly menuId: NodeId
  /** Top-level sections in order. */
  readonly rootIds: readonly NodeId[]
  readonly sections: Readonly<Record<NodeId, ComposerSection>>
  readonly items: Readonly<Record<NodeId, ComposerItem>>
  /** The items of each section in order (all of them, shown or not). */
  readonly placements: Readonly<Record<NodeId, readonly ComposerPlacement[]>>
  /** Items that sit in no section, by name. */
  readonly unsortedIds: readonly NodeId[]
  /** The venue's tag ids in order, archived ones included. */
  readonly tagIds: readonly TagId[]
  readonly tags: Readonly<Record<TagId, ComposerTag>>
  /**
   * The name of the till this menu's items come from (`{source}` in "From {source}"), or '' when
   * nothing in it comes from a till.
   */
  readonly tillLabel: string
}

function textOf(field: ResolvedField | undefined, locale: Locale): string {
  const value = field?.value
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return ''
  }
  return pickLocalized(value as LocalizedText, locale) ?? ''
}

function moneyOf(field: ResolvedField | undefined): Money | null {
  const value = field?.value
  if (value === null || value === undefined || typeof value !== 'object') return null
  const money = value as Partial<Money>
  return Number.isSafeInteger(money.amount_minor) && money.currency === 'EUR'
    ? (value as Money)
    : null
}

function hiddenByOf(
  status: string,
  visible: ResolvedField | undefined,
  orderMode: ResolvedField | undefined,
  held: boolean,
): ItemHiddenBy | null {
  if (visible?.value === false) {
    if (visible.layer === 'till') return 'till'
    if (visible.layer === 'manual') return held ? 'new_from_till' : 'builder'
    return 'other'
  }
  if (status === 'hidden') return 'status'
  if (orderMode?.value === 'hidden') return 'other'
  return null
}

const issuesOf = (issues: readonly ComposerIssue[]): ComposerIssue[] =>
  issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    ...(issue.fieldKey === undefined ? {} : { fieldKey: issue.fieldKey }),
    ...(issue.locale === undefined ? {} : { locale: issue.locale }),
  }))

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A section's layout as resolved (its field, or the template's default); vertical if unknown. */
function layoutOf(field: ResolvedField | undefined): SectionLayout {
  return SECTION_LAYOUTS.find((layout) => layout === field?.value) ?? 'vertical'
}

/**
 * The fields with a stale override (V12, the resolver's `stale_override`), in the order the
 * resolver found them: the same list `loadDraft` reports as `staleOverrides`, read from the
 * composer's own resolution, so it costs no second read.
 */
function reviewFieldsOf(issues: readonly ComposerIssue[]): string[] {
  const keys = issues
    .filter((issue) => issue.code === 'stale_override')
    .map((issue) => issue.fieldKey ?? '')
  return [...new Set(keys)]
}

/**
 * True if guests are shown the till's own name for this node (D75): the stored name was mapped
 * from a record with no public name (`fallbackIds`), and the resolved name still takes its text
 * from the till (`tillTextShown`: a name typed here replaces it and takes the warning away).
 */
function ownNameShown(
  id: NodeId,
  fallbackIds: ReadonlySet<NodeId>,
  field: ResolvedField | undefined,
): boolean {
  return fallbackIds.has(id) && tillTextShown(field)
}

/** What `buildComposerView` reads: the document (unplaced items merged in), its resolution. */
export interface BuildViewInput {
  readonly doc: MenuDocument
  readonly resolved: ResolvedMenu
  /**
   * The interface language as a document language: names and titles are shown in it. The caller
   * resolved `resolved` with the live editions (`liveEditions`), so sold-out marks are tonight's.
   */
  readonly displayLocale: Locale
  /**
   * Items the sync hid for review (`loadHeldNewItemIds`): their manual hide was written by the
   * sync, not by a person. Default: none.
   */
  readonly heldNewIds?: readonly NodeId[]
  /** The venue's tags in order, archived ones included (`listTags`). Default: none. */
  readonly tags?: readonly Tag[]
  /** The name of the till the menu's linked nodes come from (`tillLabelOf`). Default: ''. */
  readonly tillLabel?: string
  /**
   * The nodes whose till name is the till's own name, standing in for a missing public one (D75):
   * the connector's `readNameFallbackNodeIds`. Default: none.
   */
  readonly nameFallbackIds?: readonly NodeId[]
}

/** The string entries of a resolved list value (`tags`, `dietary`); nothing else. */
function listOf(field: ResolvedField | undefined): string[] {
  return Array.isArray(field?.value)
    ? (field.value as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Builds the view model of a resolved menu. */
export function buildComposerView({
  doc,
  resolved,
  displayLocale,
  heldNewIds = [],
  tags: venueTags = [],
  tillLabel = '',
  nameFallbackIds = [],
}: BuildViewInput): ComposerView {
  const heldNew = new Set<NodeId>(heldNewIds)
  const ownNames = new Set<NodeId>(nameFallbackIds)
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]))
  // Linked to the till = a till link (`till:<integration>`), whichever connector feeds it.
  const tillLinked = new Set(
    doc.links.filter((link) => isTillSource(link.source)).map((link) => link.nodeId),
  )
  const originOf = (id: NodeId): ComposerOrigin => (tillLinked.has(id) ? 'till' : 'owned')

  const sections: Record<NodeId, ComposerSection> = {}
  const addSection = (section: ResolvedSection, parentId: NodeId | null) => {
    const node = nodes.get(section.id)
    sections[section.id] = {
      id: section.id,
      parentId,
      title: textOf(section.fields.title, displayLocale),
      origin: originOf(section.id),
      hidden: node?.status === 'hidden',
      shown: section.visible,
      sortKey: node?.sortKey ?? '',
      childIds: section.children.map((child) => child.id),
      issues: issuesOf(section.issues),
      nameFromTill: ownNameShown(section.id, ownNames, section.fields.title),
      layout: layoutOf(section.fields.layout),
    }
    for (const child of section.children) addSection(child, section.id)
  }
  for (const section of resolved.sections) addSection(section, null)

  // Placements: the smallest key per (section, item), for sections and items the view has.
  const keyed = new Map<NodeId, Map<NodeId, string>>()
  for (const placement of doc.placements) {
    if (!sections[placement.sectionId] || !resolved.items[placement.itemId]) continue
    const inSection = keyed.get(placement.sectionId) ?? new Map<NodeId, string>()
    const current = inSection.get(placement.itemId)
    if (current === undefined || placement.sortKey < current) {
      inSection.set(placement.itemId, placement.sortKey)
    }
    keyed.set(placement.sectionId, inSection)
  }
  const placements: Record<NodeId, ComposerPlacement[]> = {}
  const placedItems = new Set<NodeId>()
  for (const id of Object.keys(sections) as NodeId[]) {
    const inSection = keyed.get(id) ?? new Map<NodeId, string>()
    placements[id] = [...inSection.entries()]
      .map(([itemId, sortKey]) => ({ itemId, sortKey }))
      .sort((a, b) => compareText(a.sortKey, b.sortKey) || compareText(a.itemId, b.itemId))
    for (const itemId of inSection.keys()) placedItems.add(itemId)
  }

  const items: Record<NodeId, ComposerItem> = {}
  for (const [id, item] of Object.entries(resolved.items) as [
    NodeId,
    (typeof resolved.items)[NodeId],
  ][]) {
    items[id] = {
      id,
      name: textOf(item.fields.name, displayLocale),
      price: moneyOf(item.fields.price),
      origin: originOf(id),
      hiddenBy: hiddenByOf(
        nodes.get(id)?.status ?? 'active',
        item.fields.visible,
        item.fields.order_mode,
        heldNew.has(id),
      ),
      shown: item.visible,
      issues: issuesOf(item.issues),
      tags: listOf(item.fields.tags).filter((tag): tag is TagId => isId('tg', tag)),
      dietary: listOf(item.fields.dietary),
      ...saleStateOf(item.fields.for_sale),
      nameFromTill: ownNameShown(id, ownNames, item.fields.name),
      reviewFields: reviewFieldsOf(item.issues),
    }
  }

  const tagRecords: Record<TagId, ComposerTag> = {}
  for (const tag of venueTags) {
    tagRecords[tag.id] = {
      id: tag.id,
      name: pickLocalized(tag.label, displayLocale) ?? '',
      label: tag.label,
      color: tag.color,
      archived: tag.archived,
    }
  }

  const unsortedIds = (Object.keys(items) as NodeId[])
    .filter((id) => !placedItems.has(id))
    .sort((a, b) => {
      const left = items[a]?.name ?? ''
      const right = items[b]?.name ?? ''
      return left.localeCompare(right, displayLocale.replace('_', '-')) || compareText(a, b)
    })

  return {
    menuId: doc.menu.id,
    rootIds: resolved.sections.map((section) => section.id),
    sections,
    items,
    placements,
    unsortedIds,
    tagIds: venueTags.map((tag) => tag.id),
    tags: tagRecords,
    tillLabel,
  }
}
