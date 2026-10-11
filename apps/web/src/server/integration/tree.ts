// Two small readers of what the connection check cached (brief S2-05): the public category tree
// for the catalogue-root picker, and the characteristics barsy offers (to pick the allergen one).
// Pure, and forgiving: a cache that does not look as expected is an empty list, never an error.
import { isAllergenDetailName } from '@restro/core'

import type { AllergenOption, CategoryNode } from './view'

/** A category as the cache keeps it (`integrations.config.catalogue_trees.<bid>.categories`). */
export interface CachedCategory {
  readonly cat_id: number
  readonly parent_id: number | null
  readonly name: string
}

/**
 * Nests the flat cached list. A category whose parent is not in the list becomes a top-level one,
 * and each category is placed once, so a damaged cache cannot loop. Siblings keep the order of
 * the cache (barsy's order). The category numbered `suggestedId` (the venue's public menu, per its
 * stored record) is marked `suggested`; nothing else is, and nothing is chosen by it.
 */
export function buildCategoryTree(
  categories: readonly CachedCategory[],
  suggestedId: number | null = null,
): CategoryNode[] {
  const ids = new Set(categories.map((category) => category.cat_id))
  const childrenOf = new Map<number | null, CachedCategory[]>()
  for (const category of categories) {
    const parent =
      category.parent_id !== null &&
      category.parent_id !== category.cat_id &&
      ids.has(category.parent_id)
        ? category.parent_id
        : null
    const siblings = childrenOf.get(parent) ?? []
    siblings.push(category)
    childrenOf.set(parent, siblings)
  }
  const placed = new Set<number>()
  const build = (parent: number | null): CategoryNode[] =>
    (childrenOf.get(parent) ?? []).flatMap((category) => {
      if (placed.has(category.cat_id)) return []
      placed.add(category.cat_id)
      return [
        {
          id: category.cat_id,
          name: category.name,
          children: build(category.cat_id),
          ...(category.cat_id === suggestedId ? { suggested: true as const } : {}),
        },
      ]
    })
  return build(null)
}

/** True if `catId` is a category of the tree. */
export function treeHas(tree: readonly CategoryNode[], catId: number): boolean {
  return tree.some((node) => node.id === catId || treeHas(node.children, catId))
}

/** The characteristics in barsy's `Articledetails_gettree` answer: `[{ details: { k102: { detail_name } } }]`. */
export function readDetailOptions(payload: unknown): AllergenOption[] {
  if (!Array.isArray(payload)) return []
  const found = new Map<string, string>()
  for (const group of payload) {
    const details = (group as { details?: unknown } | null)?.details
    if (typeof details !== 'object' || details === null || Array.isArray(details)) continue
    for (const [key, detail] of Object.entries(details)) {
      const name = (detail as { detail_name?: unknown } | null)?.detail_name
      if (typeof name === 'string' && name.trim() !== '' && !found.has(key)) {
        found.set(key, name.trim())
      }
    }
  }
  return [...found].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The characteristic the sync picks for allergens when none is configured: the one named
 * "Алергени" or "Allergens" in any case, the lowest key if several (as the sync does).
 */
export function detectAllergenOption(options: readonly AllergenOption[]): AllergenOption | null {
  const matching = options
    .filter((option) => isAllergenDetailName(option.name))
    .map((option) => option.key)
    .sort()
  const key = matching[0]
  return key === undefined ? null : (options.find((option) => option.key === key) ?? null)
}
