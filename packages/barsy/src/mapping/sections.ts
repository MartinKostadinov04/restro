// The category tree → the sections of the menu (doc "Categories → Sections"; D20: our section map
// is generated from barsy's category tree). The catalogue root is the menu root itself; its
// children become sections, to the template's maximum depth. A deeper category is flattened into
// its depth-3 ancestor: its articles sit in that section, it has no section of its own.

import { MAX_SECTION_DEPTH } from '@restro/core'
import type { CategoryTreeNode } from '../read/schemas.ts'
import { BarsyMappingError } from './errors.ts'
import type { MappingWarning } from './types.ts'

export interface SectionPlan {
  readonly catId: number
  readonly node: CategoryTreeNode
  /** The barsy id of the parent section; null for a section directly under the menu root. */
  readonly parentCatId: number | null
  /** 1 for a section directly under the menu root. */
  readonly depth: number
}

export interface SectionsPlan {
  /** Sections in tree order, parents before children. */
  readonly sections: readonly SectionPlan[]
  /** Every category of the subtree → the section its articles belong to (itself, or its ancestor). */
  readonly sectionOf: ReadonlyMap<number, number>
  /** A section's position in `sections`. */
  readonly indexOf: ReadonlyMap<number, number>
}

/** The tree node of a category, searched depth first. */
export function findCategory(root: CategoryTreeNode, catId: number): CategoryTreeNode | null {
  if (root.category.cat_id === catId) return root
  for (const child of root.categories) {
    const found = findCategory(child, catId)
    if (found !== null) return found
  }
  return null
}

export function planSections(
  tree: CategoryTreeNode,
  rootCatId: number,
  warnings: MappingWarning[],
): SectionsPlan {
  const root = findCategory(tree, rootCatId)
  if (root === null) {
    throw new BarsyMappingError(
      'catalogue_root_not_found',
      `category ${rootCatId} is not in this venue's category tree`,
    )
  }
  const sections: SectionPlan[] = []
  const sectionOf = new Map<number, number>()
  const indexOf = new Map<number, number>()
  // A category listed twice is mapped once (a second listing would collide on the same link).
  const seen = new Set<number>([rootCatId])

  const visit = (node: CategoryTreeNode, depth: number, ancestor: SectionPlan | null): void => {
    for (const child of node.categories) {
      const catId = child.category.cat_id
      if (catId === null || seen.has(catId)) continue
      seen.add(catId)
      if (depth + 1 <= MAX_SECTION_DEPTH) {
        const plan: SectionPlan = {
          catId,
          node: child,
          parentCatId: ancestor?.catId ?? null,
          depth: depth + 1,
        }
        indexOf.set(catId, sections.length)
        sections.push(plan)
        sectionOf.set(catId, catId)
        visit(child, depth + 1, plan)
      } else if (ancestor !== null) {
        sectionOf.set(catId, ancestor.catId)
        warnings.push({
          code: 'category_flattened',
          externalType: 'category',
          externalId: String(catId),
          detail: `into ${ancestor.catId}`,
        })
        visit(child, depth + 1, ancestor)
      }
    }
  }
  visit(root, 0, null)
  return { sections, sectionOf, indexOf }
}
