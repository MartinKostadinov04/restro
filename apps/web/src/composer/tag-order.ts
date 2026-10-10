// Putting tags in order by dragging (brief S3-06). The list is positions; the server takes "before
// this tag" or "to the end", which cannot go stale the way an index can. Pure.

import type { TagId } from '@restro/core'

/**
 * Where a dragged tag goes: the tag it lands before, or `null` for the end. `listed` is the tags
 * as the list shows them (the active ones, in order) and `index` the place the drop gave the tag
 * in that list. The tag counts as having left its own place first, so the one now sitting at
 * `index` among the others is the one it goes before.
 */
export function beforeIdForDrop(
  listed: readonly TagId[],
  dragged: TagId,
  index: number,
): TagId | null {
  const rest = listed.filter((id) => id !== dragged)
  return rest[index] ?? null
}
