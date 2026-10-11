// The resolver (doc "Layers, ownership and resolution", "Validation and quality gates"; brief
// S2-04): a pure, deterministic function from the template, the layered menu document and a
// context (venue, editions, languages, time) to the resolved menu. No I/O, no clock, no
// randomness; the order of the input arrays never changes the output.

import { isScope, isTillSource, type Layer } from '../change-set'
import type { MenuDocument } from '../document/types'
import type { FieldDefinition } from '../field-definition'
import { canonicalJson } from '../hash'
import type { NodeId } from '../ids'
import { isLocale, type Locale, type LocalizedText } from '../locales'
import { addMinor, type Money, MoneyError } from '../money'
import type { NodeType } from '../node-types'
import { compareSortKeys } from '../sort-keys'
import type { Template } from '../template'
import { combineField, readsLayer } from './combine'
import { indexRows, isEmptyValue, type LayerValue, pickLayers, type RowIndex } from './layers'
import type {
  Issue,
  IssueCode,
  IssueSeverity,
  ResolveContext,
  ResolvedField,
  ResolvedItem,
  ResolvedMenu,
  ResolvedModifierGroup,
  ResolvedOption,
  ResolvedSection,
} from './types'

type DocNode = MenuDocument['nodes'][number]
type DocLink = MenuDocument['links'][number]

/** Field keys with a meaning beyond their combinator (doc "Standard Item fields", D29). */
const KEYS = {
  name: 'name',
  title: 'title',
  price: 'price',
  forSale: 'for_sale',
  visible: 'visible',
  orderMode: 'order_mode',
  allergens: 'allergens',
  dietary: 'dietary',
  tags: 'tags',
  min: 'min',
  max: 'max',
  priceDelta: 'price_delta',
} as const

/** V3: the field that must hold text in the menu's default language, per node type. */
const V3_FIELD: Partial<Record<NodeType, string>> = { item: KEYS.name, section: KEYS.title }

/** The `new` badge lasts this long after an item is first published. */
const NEW_BADGE_MS = 14 * 24 * 60 * 60 * 1000

function compareText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Issues, deduplicated and kept in one stable order (menu-level first, then by node). */
class IssueBook {
  private readonly issues = new Map<string, Issue>()
  private readonly blocked = new Set<NodeId>()
  private byNode: Map<NodeId, Issue[]> | null = null

  add(issue: Issue): void {
    this.issues.set(IssueBook.keyOf(issue), issue)
    if (issue.nodeId !== undefined && issue.severity === 'block_node') {
      this.blocked.add(issue.nodeId)
    }
    this.byNode = null
  }

  /** Every issue of one node. */
  of(nodeId: NodeId): Issue[] {
    if (this.byNode === null) {
      this.byNode = new Map()
      for (const issue of this.all()) {
        if (issue.nodeId === undefined) continue
        const list = this.byNode.get(issue.nodeId) ?? []
        list.push(issue)
        this.byNode.set(issue.nodeId, list)
      }
    }
    return [...(this.byNode.get(nodeId) ?? [])]
  }

  /** True if the node has an issue that leaves it out of the snapshot. */
  blocks(nodeId: NodeId): boolean {
    return this.blocked.has(nodeId)
  }

  /** True if some issue has this code. */
  has(code: IssueCode): boolean {
    for (const issue of this.issues.values()) if (issue.code === code) return true
    return false
  }

  all(): Issue[] {
    return [...this.issues.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([, issue]) => issue)
  }

  private static keyOf(issue: Issue): string {
    return [
      issue.nodeId ?? '',
      issue.fieldKey ?? '',
      issue.locale ?? '',
      issue.code,
      issue.severity,
    ].join('\u0000')
  }
}

/** What a node's source links say about it. */
interface LinkFacts {
  /** It has a till link (source `till:…`), whatever its state: `locked` fields read the till alone. */
  readonly linkedToTill: boolean
  /**
   * It is an item with an active till link: the first condition of `orderable`. The link's
   * external type is the connector's business, checked when the link is made (`apply()`).
   */
  readonly tillItem: boolean
  /** A link is deleted or missing: the node is hidden whatever its status (rule 6). */
  readonly broken: 'link_deleted' | 'link_missing' | null
}

function linkFacts(node: DocNode, links: readonly DocLink[]): LinkFacts {
  const till = links.filter((link) => isTillSource(link.source))
  const deleted = links.some((link) => link.state === 'deleted')
  const missing = links.some((link) => link.state === 'missing')
  return {
    linkedToTill: till.length > 0,
    tillItem: node.type === 'item' && till.some((link) => link.state === 'active'),
    broken: deleted ? 'link_deleted' : missing ? 'link_missing' : null,
  }
}

/** One node's resolved fields and the layer values each was resolved from. */
interface NodeFields {
  readonly fields: Record<string, ResolvedField>
  readonly layers: ReadonlyMap<string, ReadonlyMap<Layer, LayerValue>>
}

function publicDefinitions(template: Template, type: NodeType): FieldDefinition[] {
  return (template.nodeTypes[type]?.fields ?? []).filter((def) => def.visibility === 'public')
}

function textIn(value: ResolvedField['value'], locale: Locale): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const text = (value as LocalizedText)[locale]
  return text !== undefined && text.trim().length > 0
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    'amount_minor' in value &&
    'currency' in value &&
    Number.isSafeInteger((value as Money).amount_minor)
  )
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((member) => typeof member === 'string') : []
}

/** The node's own data says it may be shown: active, links intact, not hidden, not blocked. */
function shownByData(
  node: DocNode,
  facts: LinkFacts,
  fields: NodeFields,
  book: IssueBook,
): boolean {
  return (
    node.status === 'active' &&
    facts.broken === null &&
    fields.fields[KEYS.visible]?.value !== false &&
    fields.fields[KEYS.orderMode]?.value !== 'hidden' &&
    !book.blocks(node.id)
  )
}

/** Picks the node to keep when the document repeats an id (never depends on input order). */
function preferNode(a: DocNode, b: DocNode): DocNode {
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b
  return canonicalJson(a) >= canonicalJson(b) ? a : b
}

function byId<T extends { readonly id: NodeId }>(a: T, b: T): number {
  return compareText(a.id, b.id)
}

/**
 * Sibling order (sections, modifier groups, options): by sort key in code-unit order, a node
 * without a key after those with one, then by id so equal keys still give one order.
 */
function bySiblingOrder(a: DocNode, b: DocNode): number {
  if (a.sortKey !== b.sortKey) {
    if (a.sortKey === null) return 1
    if (b.sortKey === null) return -1
    return compareSortKeys(a.sortKey, b.sortKey)
  }
  return byId(a, b)
}

/**
 * Resolves a menu document for one venue and edition: one value per field per node with its
 * provenance, the computed item fields, visibility and the issues of checks V3–V7, V9, V10 and
 * V12 (V8 needs asset sizes; V11 compares two resolutions: `compareVisibility`).
 *
 * - Each field: the rows of this venue's scope and of `master` (venue beats master per layer),
 *   of the base layers and of the active editions, combined by the definition's combinator.
 * - A node is shown only if it is active, none of its source links is missing or deleted
 *   (rule 6), its `visible` flag is not false, its `order_mode` is not `hidden`, it has no
 *   `block_node` issue, its parents are shown, and — for an item — it is placed in a shown
 *   section; a section with no shown item is hidden (V9).
 * - Archived nodes are left out entirely; internal fields never appear.
 */
export function resolve(
  template: Template,
  doc: MenuDocument,
  context: ResolveContext,
): ResolvedMenu {
  const book = new IssueBook()
  const menuIssue = (code: IssueCode) => book.add({ code, severity: 'block_menu' })

  // Context and inputs that must fit together.
  const venueScope = context.venueScope
  if (!isScope(venueScope) || !venueScope.startsWith('venue:')) menuIssue('invalid_context')
  if (`venue:${doc.menu.venueId}` !== venueScope) menuIssue('venue_mismatch')
  if (template.key !== doc.menu.templateKey || template.version !== doc.menu.templateVersion) {
    menuIssue('template_mismatch')
  }
  const locales = [...new Set(context.locales.filter(isLocale))]
  const defaultLocale = locales[0]
  if (defaultLocale === undefined) menuIssue('no_locales')
  const now = Date.parse(context.now)
  if (!Number.isFinite(now)) menuIssue('invalid_context')
  const activeEditions =
    context.edition === undefined ? null : new Set(context.edition.map((id) => `edition:${id}`))
  const rows: RowIndex = indexRows(
    doc.values,
    venueScope,
    (layer) => activeEditions === null || activeEditions.has(layer),
  )

  // Nodes by id, their children and links.
  const nodes = new Map<NodeId, DocNode>()
  for (const node of doc.nodes) {
    const current = nodes.get(node.id)
    nodes.set(node.id, current === undefined ? node : preferNode(current, node))
  }
  // Children of each node in sibling order (sort key, then id).
  const children = new Map<NodeId, DocNode[]>()
  for (const node of [...nodes.values()].sort(bySiblingOrder)) {
    if (node.parentId === null || node.status === 'archived') continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const childrenOfType = (id: NodeId, type: NodeType) =>
    (children.get(id) ?? []).filter((child) => child.type === type)
  const linksOf = new Map<NodeId, DocLink[]>()
  for (const link of doc.links)
    linksOf.set(link.nodeId, [...(linksOf.get(link.nodeId) ?? []), link])
  const factsOf = (id: NodeId): LinkFacts => {
    const node = nodes.get(id)
    return node === undefined
      ? { linkedToTill: false, tillItem: false, broken: null }
      : linkFacts(node, linksOf.get(id) ?? [])
  }

  const root = nodes.get(doc.menu.rootNodeId)
  if (root === undefined || root.type !== 'menu' || root.status === 'archived') {
    menuIssue('missing_root')
    return {
      menuId: doc.menu.id,
      venueScope,
      menu: { id: doc.menu.rootNodeId, fields: {}, issues: [] },
      sections: [],
      items: {},
      modifierGroups: {},
      options: {},
      issues: book.all(),
    }
  }

  // Which nodes take part: the section tree under the root, every item, their groups and options.
  const sectionParent = new Map<NodeId, NodeId>()
  const sectionOrder: DocNode[] = []
  const queue: DocNode[] = [root]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of childrenOfType(next.id, 'section')) {
      if (sectionParent.has(child.id) || child.id === root.id) continue
      sectionParent.set(child.id, next.id)
      sectionOrder.push(child)
      queue.push(child)
    }
  }
  const items = [...nodes.values()]
    .filter((node) => node.type === 'item' && node.status !== 'archived')
    .sort(byId)
  const groups = items.flatMap((item) => childrenOfType(item.id, 'modifier_group'))
  const options = groups.flatMap((group) => childrenOfType(group.id, 'option'))
  const included = new Set<NodeId>([
    root.id,
    ...sectionOrder.map((node) => node.id),
    ...items.map((node) => node.id),
    ...groups.map((node) => node.id),
    ...options.map((node) => node.id),
  ])
  reportOrphans(nodes, included, book)

  // Fields and node checks.
  const resolved = new Map<NodeId, NodeFields>()
  for (const node of [root, ...sectionOrder, ...items, ...groups, ...options]) {
    const facts = factsOf(node.id)
    const fields = resolveFields(template, node, facts, rows, locales, book)
    resolved.set(node.id, fields)
    checkNode(template, node, facts, fields, defaultLocale, locales, book)
  }
  const fieldsOf = (id: NodeId): NodeFields => resolved.get(id) ?? { fields: {}, layers: new Map() }
  const dataShown = (node: DocNode) => shownByData(node, factsOf(node.id), fieldsOf(node.id), book)

  // Section visibility, top-down: a section is a candidate if it and every parent may be shown.
  const rootShown = dataShown(root)
  const sectionCandidate = new Map<NodeId, boolean>()
  for (const section of sectionOrder) {
    const parent = sectionParent.get(section.id)
    const parentShown = parent === root.id ? rootShown : sectionCandidate.get(parent ?? root.id)
    sectionCandidate.set(section.id, parentShown === true && dataShown(section))
  }

  // Placements: each item at most once per section (the smallest key), in sort-key order.
  const itemIds = new Set(items.map((item) => item.id))
  const placed = new Map<NodeId, Map<NodeId, string>>()
  for (const placement of doc.placements) {
    if (!itemIds.has(placement.itemId) || !sectionParent.has(placement.sectionId)) continue
    const inSection = placed.get(placement.sectionId) ?? new Map<NodeId, string>()
    const current = inSection.get(placement.itemId)
    if (current === undefined || compareText(placement.sortKey, current) < 0) {
      inSection.set(placement.itemId, placement.sortKey)
    }
    placed.set(placement.sectionId, inSection)
  }
  const itemsIn = (sectionId: NodeId): NodeId[] =>
    [...(placed.get(sectionId) ?? new Map<NodeId, string>()).entries()]
      .sort(
        ([itemA, keyA], [itemB, keyB]) => compareSortKeys(keyA, keyB) || compareText(itemA, itemB),
      )
      .map(([itemId]) => itemId)

  // Item visibility: shown by its own data and placed in at least one candidate section.
  const itemDataShown = new Map(items.map((item) => [item.id, dataShown(item)]))
  const itemVisible = new Map<NodeId, boolean>()
  const itemPlaced = new Set<NodeId>()
  for (const section of sectionOrder) {
    for (const itemId of itemsIn(section.id)) {
      itemPlaced.add(itemId)
      if (sectionCandidate.get(section.id) === true && itemDataShown.get(itemId) === true) {
        itemVisible.set(itemId, true)
      }
    }
  }
  for (const item of items) {
    if (itemDataShown.get(item.id) === true && !itemPlaced.has(item.id)) {
      book.add({ code: 'unplaced_item', severity: 'warning', nodeId: item.id })
    }
  }

  // Section visibility, bottom-up (V9): a candidate section is shown if it holds a shown item.
  const sectionVisible = new Map<NodeId, boolean>()
  for (const section of [...sectionOrder].reverse()) {
    const candidate = sectionCandidate.get(section.id) === true
    const hasItem = itemsIn(section.id).some((itemId) => itemVisible.get(itemId) === true)
    const hasChild = childrenOfType(section.id, 'section').some(
      (child) => sectionVisible.get(child.id) === true,
    )
    sectionVisible.set(section.id, candidate && (hasItem || hasChild))
    if (candidate && !hasItem && !hasChild) {
      book.add({ code: 'V9', severity: 'warning', nodeId: section.id })
    }
  }

  // Modifier groups and options, then the computed item fields.
  const groupShown = new Map(groups.map((group) => [group.id, dataShown(group)]))
  const optionShown = new Map(options.map((option) => [option.id, dataShown(option)]))
  const computedOf = new Map<NodeId, ResolvedItem['computed']>()
  for (const item of items) {
    computedOf.set(
      item.id,
      computeItem(item, {
        facts: factsOf(item.id),
        fields: fieldsOf(item.id),
        visible: itemVisible.get(item.id) === true,
        requiredGroups: childrenOfType(item.id, 'modifier_group')
          .filter((group) => requiredMin(fieldsOf(group.id)) > 0)
          .map((group) => ({
            min: requiredMin(fieldsOf(group.id)),
            shown: groupShown.get(group.id) === true,
            deltas: childrenOfType(group.id, 'option')
              .filter((option) => optionShown.get(option.id) === true)
              .map((option) => fieldsOf(option.id).fields[KEYS.priceDelta]?.value ?? null),
          })),
        venueScope,
        now,
        firstPublishedAt: context.firstPublishedAt?.[item.id],
        book,
      }),
    )
  }
  if (![...itemVisible.values()].some(Boolean)) menuIssue('V10')
  if (book.has('stale_override')) book.add({ code: 'V12', severity: 'warning' })

  // Assembly, after every issue is known.
  const buildSection = (section: DocNode): ResolvedSection => ({
    id: section.id,
    fields: fieldsOf(section.id).fields,
    children: childrenOfType(section.id, 'section')
      .filter((child) => sectionParent.get(child.id) === section.id)
      .map(buildSection),
    itemIds: itemsIn(section.id),
    visible: sectionVisible.get(section.id) === true,
    issues: book.of(section.id),
  })
  const resolvedItems: Record<NodeId, ResolvedItem> = {}
  for (const item of items) {
    resolvedItems[item.id] = {
      id: item.id,
      fields: fieldsOf(item.id).fields,
      computed: computedOf.get(item.id) ?? { orderable: false, priceFrom: null, badges: [] },
      visible: itemVisible.get(item.id) === true,
      modifierGroupIds: childrenOfType(item.id, 'modifier_group').map((group) => group.id),
      issues: book.of(item.id),
    }
  }
  const resolvedGroups: Record<NodeId, ResolvedModifierGroup> = {}
  for (const group of groups) {
    const itemId = group.parentId as NodeId
    resolvedGroups[group.id] = {
      id: group.id,
      itemId,
      fields: fieldsOf(group.id).fields,
      required: requiredMin(fieldsOf(group.id)) > 0,
      optionIds: childrenOfType(group.id, 'option').map((option) => option.id),
      visible: groupShown.get(group.id) === true && itemVisible.get(itemId) === true,
      issues: book.of(group.id),
    }
  }
  const resolvedOptions: Record<NodeId, ResolvedOption> = {}
  for (const option of options) {
    const groupId = option.parentId as NodeId
    resolvedOptions[option.id] = {
      id: option.id,
      groupId,
      fields: fieldsOf(option.id).fields,
      visible: optionShown.get(option.id) === true && resolvedGroups[groupId]?.visible === true,
      issues: book.of(option.id),
    }
  }

  return {
    menuId: doc.menu.id,
    venueScope,
    menu: { id: root.id, fields: fieldsOf(root.id).fields, issues: book.of(root.id) },
    sections: childrenOfType(root.id, 'section')
      .filter((section) => sectionParent.get(section.id) === root.id)
      .map(buildSection),
    items: resolvedItems,
    modifierGroups: resolvedGroups,
    options: resolvedOptions,
    issues: book.all(),
  }
}

/**
 * Sections, groups and options that are not archived, not inside an archived subtree, and still
 * not reachable from the root (their parent is missing or cannot hold them) are reported.
 */
function reportOrphans(
  nodes: ReadonlyMap<NodeId, DocNode>,
  included: Set<NodeId>,
  book: IssueBook,
) {
  const placedTypes: readonly NodeType[] = ['section', 'modifier_group', 'option']
  for (const node of [...nodes.values()].sort(byId)) {
    if (included.has(node.id) || node.status === 'archived') continue
    if (!placedTypes.includes(node.type)) continue
    let insideArchived = false
    const seen = new Set<NodeId>([node.id])
    for (let parentId = node.parentId; parentId !== null && !seen.has(parentId); ) {
      seen.add(parentId)
      const parent = nodes.get(parentId)
      if (parent === undefined) break
      if (parent.status === 'archived') {
        insideArchived = true
        break
      }
      parentId = parent.parentId
    }
    if (!insideArchived) book.add({ code: 'orphan_node', severity: 'warning', nodeId: node.id })
  }
}

/** Resolves every public field of one node, in template order. */
function resolveFields(
  template: Template,
  node: DocNode,
  facts: LinkFacts,
  rows: RowIndex,
  locales: readonly Locale[],
  book: IssueBook,
): NodeFields {
  const fields: Record<string, ResolvedField> = {}
  const layers = new Map<string, ReadonlyMap<Layer, LayerValue>>()
  const stored = rows.get(node.id)
  for (const definition of publicDefinitions(template, node.type)) {
    const fieldKey = definition.key
    const picked = pickLayers(
      definition,
      stored?.get(fieldKey),
      (layer) => readsLayer(definition, facts.linkedToTill, layer),
      definition.combinator === 'all_true',
    )
    const note = (code: IssueCode, severity: IssueSeverity) =>
      book.add({ code, severity, nodeId: node.id, fieldKey })
    if (picked.invalid) note('invalid_value', 'warning')
    if (picked.ignored) note('ignored_value', 'warning')
    const outcome = combineField({
      definition,
      layers: picked.values,
      linkedToTill: facts.linkedToTill,
      locales,
    })
    fields[fieldKey] = outcome.field
    layers.set(fieldKey, picked.values)
    for (const issue of outcome.issues) {
      book.add({ ...issue, nodeId: node.id, fieldKey })
    }
  }
  return { fields, layers }
}

/**
 * Node checks: broken links (rule 6), V3 (name in the default language), required fields (V4 for
 * allergens), V6 (price), V7 (every enabled language), the till price's scope, and a modifier
 * group's `min ≤ max`.
 */
function checkNode(
  template: Template,
  node: DocNode,
  facts: LinkFacts,
  { fields, layers }: NodeFields,
  defaultLocale: Locale | undefined,
  locales: readonly Locale[],
  book: IssueBook,
): void {
  const nodeId = node.id
  if (facts.broken !== null) book.add({ code: facts.broken, severity: 'block_node', nodeId })

  for (const definition of publicDefinitions(template, node.type)) {
    const fieldKey = definition.key
    const field = fields[fieldKey]
    const value = field?.value ?? null
    const empty = value === null || isEmptyValue(definition, value)
    if (V3_FIELD[node.type] === fieldKey) {
      if (defaultLocale !== undefined && !textIn(value, defaultLocale)) {
        book.add({ code: 'V3', severity: 'block_node', nodeId, fieldKey })
      }
    } else if (definition.required === true && empty) {
      const code = node.type === 'item' && fieldKey === KEYS.allergens ? 'V4' : 'required_missing'
      book.add({ code, severity: definition.critical ? 'block_node' : 'warning', nodeId, fieldKey })
    }
    if (definition.type === 'localized_text' && !empty) {
      for (const locale of locales) {
        if (!textIn(value, locale))
          book.add({ code: 'V7', severity: 'warning', nodeId, fieldKey, locale })
      }
    }
  }

  if (node.type === 'item') {
    const orderMode = fields[KEYS.orderMode]?.value
    const price = fields[KEYS.price]
    const shownWithPrice = facts.linkedToTill || orderMode === 'ask_waiter'
    if (orderMode !== 'hidden' && shownWithPrice && (price === undefined || price.value === null)) {
      book.add({ code: 'V6', severity: 'block_node', nodeId, fieldKey: KEYS.price })
    }
    const tillPrice = layers.get(KEYS.price)?.get('till')
    if (facts.linkedToTill && tillPrice !== undefined && tillPrice.scope === 'master') {
      book.add({
        code: 'price_not_venue_scoped',
        severity: 'warning',
        nodeId,
        fieldKey: KEYS.price,
      })
    }
  }

  if (node.type === 'modifier_group') {
    const min = fields[KEYS.min]?.value
    const max = fields[KEYS.max]?.value
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      book.add({ code: 'group_min_max', severity: 'block_node', nodeId })
    }
  }
}

/** The number of choices a modifier group requires (0 when optional, infinite when unknown). */
function requiredMin({ fields }: NodeFields): number {
  const min = fields[KEYS.min]?.value
  if (typeof min === 'number' && Number.isSafeInteger(min) && min >= 0) return min
  // Unknown (missing or invalid): the guest may have to choose, and nobody can say how many,
  // so the group counts as required and unsatisfiable (its item is never orderable).
  return Number.POSITIVE_INFINITY
}

interface RequiredGroup {
  readonly min: number
  /** The group itself may be shown (active, links intact, not blocked). */
  readonly shown: boolean
  /** `price_delta` of each option that may be shown (null = no delta: a free choice). */
  readonly deltas: readonly ResolvedField['value'][]
}

interface ItemInputs {
  readonly facts: LinkFacts
  readonly fields: NodeFields
  readonly visible: boolean
  readonly requiredGroups: readonly RequiredGroup[]
  readonly venueScope: `venue:${string}`
  readonly now: number
  readonly firstPublishedAt: string | undefined
  readonly book: IssueBook
}

/**
 * The delta of each option of a group a guest can choose, ascending: no delta is a free choice;
 * an option priced in another currency than the item cannot be chosen consistently. A group that
 * may not be shown offers nothing.
 */
function choosableDeltas(group: RequiredGroup, currency: string | null): number[] {
  if (!group.shown) return []
  const deltas: number[] = []
  for (const delta of group.deltas) {
    if (delta === null) deltas.push(0)
    else if (isMoney(delta) && (currency === null || delta.currency === currency)) {
      deltas.push(delta.amount_minor)
    }
  }
  return deltas.sort((a, b) => a - b)
}

/**
 * The cheapest total a guest can pay: the item's price plus, for every required group, its `min`
 * cheapest choosable options (null when a required group cannot be satisfied). Integer minor
 * units only (rule 8); null if the sum leaves the safe-integer range.
 */
function cheapestTotal(price: Money, groups: readonly RequiredGroup[]): number | null {
  let total = price.amount_minor
  for (const group of groups) {
    const deltas = choosableDeltas(group, price.currency)
    if (deltas.length < group.min) return null
    for (const amount of deltas.slice(0, group.min)) {
      try {
        total = addMinor(total, amount)
      } catch (error) {
        if (error instanceof MoneyError) return null
        throw error
      }
    }
  }
  return total
}

/** `orderable`, `priceFrom` and `badges` of one item (doc "Computed fields"). */
function computeItem(item: DocNode, inputs: ItemInputs): ResolvedItem['computed'] {
  const { fields, layers } = inputs.fields
  const priceField = fields[KEYS.price]
  const priceValue = priceField?.value
  const price = isMoney(priceValue) ? priceValue : null
  const groupsOk = inputs.requiredGroups.every(
    (group) => choosableDeltas(group, price?.currency ?? null).length >= group.min,
  )
  if (!groupsOk) {
    inputs.book.add({ code: 'required_group_unsatisfiable', severity: 'warning', nodeId: item.id })
  }

  const total = price === null ? null : cheapestTotal(price, inputs.requiredGroups)
  const priceFrom =
    price === null || total === null || total === price.amount_minor
      ? null
      : { amount_minor: total, currency: price.currency }

  const tillPrice = layers.get(KEYS.price)?.get('till')
  const pricedByTillHere =
    price !== null &&
    priceField?.provenance === 'locked' &&
    priceField.layer === 'till' &&
    tillPrice?.scope === inputs.venueScope
  const forSale = fields[KEYS.forSale]
  const forSaleByTill =
    forSale?.value === true && layers.get(KEYS.forSale)?.get('till')?.value === true
  const orderable =
    inputs.visible &&
    inputs.facts.tillItem &&
    pricedByTillHere &&
    forSaleByTill &&
    fields[KEYS.orderMode]?.value === 'orderable' &&
    groupsOk

  const badges: string[] = []
  const first = inputs.firstPublishedAt === undefined ? NaN : Date.parse(inputs.firstPublishedAt)
  if (Number.isFinite(first) && Number.isFinite(inputs.now) && inputs.now - first < NEW_BADGE_MS) {
    badges.push('new')
  }
  for (const badge of [
    ...stringsOf(fields[KEYS.dietary]?.value),
    ...stringsOf(fields[KEYS.tags]?.value),
  ]) {
    if (!badges.includes(badge)) badges.push(badge)
  }

  return { orderable, priceFrom, badges }
}
