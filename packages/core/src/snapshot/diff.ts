// What changed between two snapshots (brief S3-05, the Publish tab's "changes waiting"): items
// added, hidden or removed, prices and names changed, any other change of an item, and the parts
// of the menu outside the items (look, sections, texts, languages, tags, choices). Pure.
//
// A snapshot has no hidden items, so "hidden" and "removed" are the same thing here: an item the
// live snapshot shows and the next one would not. That is exactly what V11 counts, so the list is
// `compareVisibility`'s, and `hiddenShare` says how large it is against the 30% rule.

import { canonicalJson } from '../hash'
import type { NodeId } from '../ids'
import type { Locale } from '../locales'
import { compareVisibility } from '../resolve/compare-visibility'
import type { MenuSnapshot, SnapshotItem } from './schema'

/** An item of a diff: its id and its name in every language the snapshot has. */
export interface DiffItem {
  readonly id: NodeId
  readonly name: SnapshotItem['name']
}

/** An item whose price (or "from" price) differs. */
export interface DiffPrice extends DiffItem {
  readonly from: SnapshotItem['price']
  readonly to: SnapshotItem['price']
}

/** An item whose name differs in some language. */
export interface DiffRename {
  readonly id: NodeId
  readonly from: SnapshotItem['name']
  readonly to: SnapshotItem['name']
}

/** The parts of a snapshot outside the items that can differ. */
export const DIFF_AREAS = ['look', 'sections', 'menu', 'languages', 'tags'] as const
export type DiffArea = (typeof DIFF_AREAS)[number]

export interface SnapshotDiff {
  /** On the next menu, not on the live one (everything, when nothing is live yet). */
  readonly added: readonly DiffItem[]
  /** On the live menu, not on the next one: hidden, taken off the menu or deleted. Live names. */
  readonly hidden: readonly DiffItem[]
  readonly priceChanged: readonly DiffPrice[]
  readonly renamed: readonly DiffRename[]
  /** On both menus, changed in something other than the name or the price (photo, text, …). */
  readonly otherChanged: readonly DiffItem[]
  /** Parts outside the items that differ. */
  readonly areas: readonly DiffArea[]
  /** Items touched (each once) plus the parts outside the items. 0 = nothing to publish. */
  readonly total: number
  /** V11's numbers for the hidden items: share of the live items, and how many were live. */
  readonly hiddenShare: number
  readonly previouslyVisible: number
}

const EMPTY: SnapshotDiff = {
  added: [],
  hidden: [],
  priceChanged: [],
  renamed: [],
  otherChanged: [],
  areas: [],
  total: 0,
  hiddenShare: 0,
  previouslyVisible: 0,
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/** The name to sort and show by: the default language, else any language. */
function sortName(name: SnapshotItem['name'], preferred: Locale): string {
  return (name[preferred] ?? Object.values(name).find((text) => text !== undefined) ?? '').trim()
}

function byName(preferred: Locale) {
  return <T extends { readonly id: NodeId; readonly name: SnapshotItem['name'] }>(a: T, b: T) =>
    sortName(a.name, preferred).localeCompare(sortName(b.name, preferred), 'bg') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Everything about an item that is not its name or price, with its choices written out. */
function restOf(snapshot: MenuSnapshot, item: SnapshotItem) {
  const { name: _name, price: _price, price_from: _priceFrom, ...rest } = item
  const groups = item.modifier_groups.map((groupId) => {
    const group = snapshot.modifier_groups[groupId]
    return group === undefined
      ? null
      : { ...group, options: group.options.map((optionId) => snapshot.options[optionId] ?? null) }
  })
  return { ...rest, modifier_groups: groups }
}

/** The tags of the vocabulary that an item in `common` uses. */
function tagsView(snapshot: MenuSnapshot, common: ReadonlySet<string>) {
  const used = new Set<string>()
  for (const id of common) for (const tag of snapshot.items[id]?.tags ?? []) used.add(tag)
  return Object.fromEntries(Object.entries(snapshot.tags).filter(([id]) => used.has(id)))
}

/**
 * The sections both menus have, without the items one of the two lacks, so that adding or hiding
 * an item does not also read as "the sections changed" (a section appears or disappears with its
 * items: the snapshot leaves out a section with nothing to show). A rename, a reorder or a move
 * between sections still does.
 */
function sectionsView(
  snapshot: MenuSnapshot,
  items: ReadonlySet<string>,
  sections: ReadonlySet<string>,
) {
  return {
    menu: snapshot.menu.sections.filter((id) => sections.has(id)),
    sections: Object.fromEntries(
      Object.entries(snapshot.sections)
        .filter(([id]) => sections.has(id))
        .map(([id, section]) => [
          id,
          {
            ...section,
            sections: section.sections.filter((child) => sections.has(child)),
            items: section.items.filter((item) => items.has(item)),
          },
        ]),
    ),
  }
}

/**
 * The difference between the live snapshot and the next one. `live` null (nothing published yet)
 * makes every item "added". Two snapshots with the same hash have no difference.
 */
export function diffSnapshots(live: MenuSnapshot | null, next: MenuSnapshot): SnapshotDiff {
  const preferred = next.locales.default
  const sorted = byName(preferred)
  if (live === null) {
    const added = (Object.keys(next.items) as NodeId[])
      .map((id) => ({ id, name: next.items[id]?.name ?? {} }))
      .sort(sorted)
    return { ...EMPTY, added, total: added.length }
  }
  if (live.snapshot.hash === next.snapshot.hash) {
    return { ...EMPTY, previouslyVisible: Object.keys(live.items).length }
  }

  const liveIds = Object.keys(live.items) as NodeId[]
  const nextIds = Object.keys(next.items) as NodeId[]
  const common = new Set(liveIds.filter((id) => Object.hasOwn(next.items, id)))
  const commonSections = new Set(
    Object.keys(live.sections).filter((id) => Object.hasOwn(next.sections, id)),
  )

  const visibility = compareVisibility(
    { items: Object.fromEntries(liveIds.map((id) => [id, { visible: true }])) },
    { items: Object.fromEntries(nextIds.map((id) => [id, { visible: true }])) },
  )
  const hidden = visibility.hiddenItemIds
    .map((id) => ({ id, name: live.items[id]?.name ?? {} }))
    .sort(sorted)
  const added = nextIds
    .filter((id) => !Object.hasOwn(live.items, id))
    .map((id) => ({ id, name: next.items[id]?.name ?? {} }))
    .sort(sorted)

  const priceChanged: DiffPrice[] = []
  const renamed: DiffRename[] = []
  const otherChanged: DiffItem[] = []
  for (const id of common) {
    const before = live.items[id]
    const after = next.items[id]
    if (before === undefined || after === undefined || same(before, after)) continue
    if (!same(before.price, after.price) || !same(before.price_from, after.price_from)) {
      priceChanged.push({ id, name: after.name, from: before.price, to: after.price })
    }
    if (!same(before.name, after.name)) renamed.push({ id, from: before.name, to: after.name })
    if (!same(restOf(live, before), restOf(next, after))) {
      otherChanged.push({ id, name: after.name })
    }
  }
  priceChanged.sort(sorted)
  otherChanged.sort(sorted)
  renamed.sort((a, b) => sorted({ id: a.id, name: a.to }, { id: b.id, name: b.to }))

  const differs: Record<DiffArea, () => boolean> = {
    look: () => !same(live.theme, next.theme),
    sections: () =>
      !same(sectionsView(live, common, commonSections), sectionsView(next, common, commonSections)),
    menu: () =>
      !same(
        [live.menu.title, live.menu.intro, live.menu.availability],
        [next.menu.title, next.menu.intro, next.menu.availability],
      ),
    languages: () =>
      !same(
        [live.locales, live.currency, live.field_types],
        [next.locales, next.currency, next.field_types],
      ),
    tags: () => !same(tagsView(live, common), tagsView(next, common)),
  }
  const areas = DIFF_AREAS.filter((area) => differs[area]())

  const touched = new Set<string>([
    ...added.map((item) => item.id),
    ...hidden.map((item) => item.id),
    ...priceChanged.map((item) => item.id),
    ...renamed.map((item) => item.id),
    ...otherChanged.map((item) => item.id),
  ])
  return {
    added,
    hidden,
    priceChanged,
    renamed,
    otherChanged,
    areas,
    total: touched.size + areas.length,
    hiddenShare: visibility.hiddenShare,
    previouslyVisible: visibility.previouslyVisible,
  }
}
