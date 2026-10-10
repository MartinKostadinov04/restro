// The composer's view model: a plain, serialisable picture of one menu for the client component
// (server component -> client component, U4). Built on the server from the loaded document and
// its resolution; nothing in it is a barsy id (rule 3), a layer value the composer may not show,
// or a function. It is normalised (sections and items by id, ordered id lists) because every
// drag changes one list and the reducer (./reducer.ts) rewrites only that list.
//
// Pure: no I/O, no clock. The server builds it (./composer-tab.tsx); tests build it from small
// hand-made documents.

import type {
  IssueCode,
  IssueSeverity,
  Locale,
  LocalizedText,
  MenuDocument,
  Money,
  NodeId,
  ResolvedField,
  ResolvedMenu,
  ResolvedSection,
} from '@restro/core'

import { pickLocalized } from '@/fields/localized'

/** One finding of the resolver about a node, for the Issues badge and its list. */
export interface ComposerIssue {
  readonly code: IssueCode
  readonly severity: IssueSeverity
  readonly fieldKey?: string
  readonly locale?: Locale
}

/** Where a node's content comes from: mirrored from barsy, or made here (display only). */
export type ComposerOrigin = 'barsy' | 'owned'

/** A section as the composer shows it. */
export interface ComposerSection {
  readonly id: NodeId
  /** `null` = directly under the menu. */
  readonly parentId: NodeId | null
  /** Title in the interface language ('' when the section has no title). */
  readonly title: string
  readonly origin: ComposerOrigin
  /** The builder hid it (`status = hidden`); hiding a section never touches barsy. */
  readonly hidden: boolean
  /** Guests would see it (it and its parents are shown and it holds a shown item). */
  readonly shown: boolean
  readonly sortKey: string
  /** Child sections in order. */
  readonly childIds: readonly NodeId[]
  readonly issues: readonly ComposerIssue[]
}

/** Why an item is not shown to guests, as far as the composer can tell and act on. */
export type ItemHiddenBy =
  /** barsy hides it: the composer cannot show it (rule 5). */
  | 'barsy'
  /** The builder's hide flag (`visible = false` in the manual layer): showing clears it. */
  | 'builder'
  /** The sync hid a new barsy item for review (setting `publish.new_items = hold`): showing clears it. */
  | 'new_from_barsy'
  /** The item's status is `hidden` (held back): showing makes it active. */
  | 'status'
  /** Another layer or setting hides it (an edition, the ordering mode): not changed here. */
  | 'other'

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
    if (visible.layer === 'barsy') return 'barsy'
    if (visible.layer === 'manual') return held ? 'new_from_barsy' : 'builder'
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

/** What `buildComposerView` reads: the document (unplaced items merged in), its resolution. */
export interface BuildViewInput {
  readonly doc: MenuDocument
  readonly resolved: ResolvedMenu
  /** The interface language as a document language: names and titles are shown in it. */
  readonly displayLocale: Locale
  /**
   * Items the sync hid for review (`loadHeldNewItemIds`): their manual hide was written by the
   * sync, not by a person. Default: none.
   */
  readonly heldNewIds?: readonly NodeId[]
}

/** Builds the view model of a resolved menu. */
export function buildComposerView({
  doc,
  resolved,
  displayLocale,
  heldNewIds = [],
}: BuildViewInput): ComposerView {
  const heldNew = new Set<NodeId>(heldNewIds)
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]))
  const barsyLinked = new Set(
    doc.links.filter((link) => link.source.startsWith('barsy:')).map((link) => link.nodeId),
  )
  const originOf = (id: NodeId): ComposerOrigin => (barsyLinked.has(id) ? 'barsy' : 'owned')

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
  }
}
