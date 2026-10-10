// Input for check V11 (doc "Validation and quality gates"): one change set may hide or remove at
// most 30% of the visible items before an automatic publish needs a person. The resolver cannot
// see the previous resolution, so the publish gate (Stage 3) compares two of them with this.

import type { NodeId } from '../ids'

/** V11's limit: hiding a larger share of the visible items holds the automatic publish. */
export const V11_MAX_HIDDEN_SHARE = 0.3

/** The part of a resolution V11 compares: which items are visible. */
export interface VisibilityView {
  readonly items: Readonly<Record<NodeId, { readonly visible: boolean }>>
}

/** How many of the previously visible items the next resolution hides or removes. */
export interface VisibilityChange {
  /** Hidden or removed ÷ previously visible; 0 when nothing was visible before. */
  readonly hiddenShare: number
  /** The items that were visible and no longer are (removed ones included), by id. */
  readonly hiddenItemIds: readonly NodeId[]
  /** How many items were visible before. */
  readonly previouslyVisible: number
}

/** Compares two resolutions of one menu for V11. */
export function compareVisibility(prev: VisibilityView, next: VisibilityView): VisibilityChange {
  const wasVisible = (Object.keys(prev.items) as NodeId[])
    .filter((id) => prev.items[id]?.visible === true)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const hiddenItemIds = wasVisible.filter((id) => next.items[id]?.visible !== true)
  return {
    hiddenShare: wasVisible.length === 0 ? 0 : hiddenItemIds.length / wasVisible.length,
    hiddenItemIds,
    previouslyVisible: wasVisible.length,
  }
}
