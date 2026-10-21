// What the composer's structure edits write (brief S6; D89, D90, D92): renaming a section or an
// item and deleting a section, planned from the menu document as change-set ops for `apply()`.
// Pure: the server actions (`@/composer/actions`) read the document and apply what this returns.
//
// - A rename goes where the item sheet would put it (`planFieldSave`, brief S2-06b): a language
//   the till holds becomes an override over the till's text (the dictionary of a POS venue, D90,
//   D91), a language it lacks and every name of a node made here go to the manual layer. Only the
//   languages named are changed; the others stay as they are shown.
// - Deleting a section takes it and the sections under it out of the menu (status `archived`; the
//   history keeps every step, rule 2) and their items out of them, so items placed nowhere else go
//   to Unsorted. A section that mirrors a category of the till cannot be deleted (only hidden,
//   D92), and neither can one that holds such a section.
import {
  type ChangeSetOp,
  type FieldDefinition,
  isTillSource,
  LOCALES,
  type Locale,
  type LocalizedText,
  type MenuDocument,
  type NodeId,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'

import { layerView } from '@/server/item-sheet/layers'
import { planFieldSave } from '@/server/item-sheet/plan'

/** True when the node mirrors an object of a till (a till link, in any state). */
export function isTillLinked(doc: MenuDocument, nodeId: NodeId): boolean {
  return doc.links.some((link) => link.nodeId === nodeId && isTillSource(link.source))
}

/** The section and every section under it, the deepest first. */
export function sectionSubtree(doc: MenuDocument, sectionId: NodeId): NodeId[] {
  const childrenOf = new Map<NodeId, NodeId[]>()
  for (const node of doc.nodes) {
    if (node.type !== 'section' || node.parentId === null) continue
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node.id])
  }
  const out: NodeId[] = []
  const visit = (id: NodeId, seen: Set<NodeId>) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const child of childrenOf.get(id) ?? []) visit(child, seen)
    out.push(id)
  }
  visit(sectionId, new Set())
  return out
}

/** What deleting a section writes, or why it is refused. */
export type DeleteSectionPlan =
  | { readonly ok: true; readonly ops: ChangeSetOp[] }
  | { readonly ok: false; readonly error: 'till_section' | 'invalid' }

/**
 * The ops that delete a section of the document: its items (and those of the sections under it)
 * leave it, and it and its sub-sections are archived. Refused for a node that is not a live
 * section of the document, and (`till_section`) when it or a section under it mirrors the till.
 */
export function deleteSectionPlan(doc: MenuDocument, sectionId: NodeId): DeleteSectionPlan {
  const section = doc.nodes.find((node) => node.id === sectionId)
  if (section?.type !== 'section' || section.status === 'archived') {
    return { ok: false, error: 'invalid' }
  }
  const subtree = sectionSubtree(doc, sectionId)
  if (subtree.some((id) => isTillLinked(doc, id))) return { ok: false, error: 'till_section' }
  const inSubtree = new Set(subtree)
  const ops: ChangeSetOp[] = doc.placements
    .filter((placement) => inSubtree.has(placement.sectionId))
    .map((placement) => ({
      op: 'removePlacement' as const,
      item: { id: placement.itemId },
      section: { id: placement.sectionId },
    }))
  for (const id of subtree) {
    const node = doc.nodes.find((candidate) => candidate.id === id)
    if (node !== undefined && node.status !== 'archived') {
      ops.push({ op: 'setNodeStatus', node: { id }, status: 'archived' })
    }
  }
  return { ok: true, ops }
}

const definitionOf = (type: 'section' | 'item', key: string): FieldDefinition | undefined =>
  VENUE_MENU_TEMPLATE.nodeTypes[type]?.fields.find((field) => field.key === key)

function textOf(value: unknown): LocalizedText {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LocalizedText)
    : {}
}

const filled = (text: string | undefined): text is string =>
  text !== undefined && text.trim() !== ''

/** What renaming writes, or `null` when it is refused. An empty list: nothing changes. */
export type RenamePlan = { readonly ok: true; readonly ops: ChangeSetOp[] } | { readonly ok: false }

/** What a rename needs to know. */
export interface RenameInput {
  readonly doc: MenuDocument
  readonly nodeId: NodeId
  /** `section` renames its `title`, `item` its `name`. */
  readonly nodeType: 'section' | 'item'
  readonly venueId: string
  /** The new text of each language changed; the other languages stay as they are. */
  readonly text: LocalizedText
  /** The venue's main language: a name keeps a text in it (check V3). */
  readonly defaultLocale: string
  /** The venue's languages: a name is only written in them. */
  readonly languages: readonly string[]
}

/**
 * The ops that rename a section or an item in the languages given. Refused for a node that is
 * not of that type in the document, a language the venue has not enabled, a blank text, or a
 * name left without the venue's main language (check V3).
 */
export function renamePlan(input: RenameInput): RenamePlan {
  const { doc, nodeId, nodeType, text } = input
  const node = doc.nodes.find((candidate) => candidate.id === nodeId)
  if (node?.type !== nodeType || node.status === 'archived') return { ok: false }
  const fieldKey = nodeType === 'section' ? 'title' : 'name'
  const definition = definitionOf(nodeType, fieldKey)
  if (definition === undefined) return { ok: false }
  const languages = Object.keys(text) as Locale[]
  if (languages.length === 0) return { ok: false }
  if (languages.some((locale) => !input.languages.includes(locale))) return { ok: false }
  if (languages.some((locale) => !filled(text[locale]))) return { ok: false }

  const layers = layerView(doc, nodeId, fieldKey, `venue:${input.venueId}`)
  // What each language shows today (`source_first`: our override, then the till, then ours).
  const override = textOf(layers.override?.value)
  const till = textOf(layers.till?.value)
  const manual = textOf(layers.manual?.value)
  const edited: LocalizedText = {}
  for (const locale of LOCALES) {
    const shown = [override[locale], till[locale], manual[locale]].find(filled)
    const wanted = Object.hasOwn(text, locale) ? text[locale]?.trim() : shown
    if (filled(wanted)) edited[locale] = wanted
  }
  if (!filled(edited[input.defaultLocale as Locale])) return { ok: false }

  const plan = planFieldSave(
    { definition, linkedToTill: isTillLinked(doc, nodeId), layers },
    edited,
  )
  if (!plan.ok) return { ok: false }
  const ops: ChangeSetOp[] = plan.writes.map((write) => {
    const target = { id: nodeId }
    if (write.kind === 'clear') {
      return { op: 'clearField', node: target, fieldKey, layer: write.layer, scope: 'master' }
    }
    return write.layer === 'override'
      ? {
          op: 'setField',
          node: target,
          fieldKey,
          layer: 'override',
          scope: 'master',
          value: write.value as LocalizedText,
          basis: write.basis as LocalizedText,
        }
      : {
          op: 'setField',
          node: target,
          fieldKey,
          layer: 'manual',
          scope: 'master',
          value: write.value as LocalizedText,
        }
  })
  return { ok: true, ops }
}
