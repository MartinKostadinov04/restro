// Filtering the open list by tag (brief S3-06). Pure, so the rule is tested without a screen.

import type { NodeId, TagId } from '@restro/core'

import type { ComposerView } from './view-model'

/**
 * The ids a list shows under a tag filter: with no tag chosen all of them; otherwise the items
 * that hold at least one of the chosen tags. The order of the list is kept.
 */
export function filterByTags(
  view: ComposerView,
  ids: readonly NodeId[],
  filter: ReadonlySet<TagId>,
): NodeId[] {
  if (filter.size === 0) return [...ids]
  return ids.filter((id) => view.items[id]?.tags.some((tag) => filter.has(tag)) === true)
}

/** The active (non-archived) tags in the venue's order. */
export function activeTagIds(view: ComposerView): TagId[] {
  return view.tagIds.filter((id) => view.tags[id]?.archived === false)
}
