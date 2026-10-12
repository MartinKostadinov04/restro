// Several venues on one installation (brief CF-16, T50, T71) and several menus in one venue
// (D88, adjustments B3). barsy keeps items in catalogues that venues can share; each venue of
// ours shows the parts under the roots barsy designates for it (its public menu, its till tree),
// one menu per root. Items stay one per article for the installation; what is per menu is
// written per menu:
//
//   - sections: a category's section link is `category:<catId>` when no such link exists yet or
//     its section is in this menu (so a single menu keeps exactly the links it has), and
//     `category:<catId>@<qualifier>` otherwise, the qualifier being this menu's id (`nd_…`;
//     before D88 it was the venue's id, `vn_…`, and such a link of this menu is reused as it is);
//   - absence in one venue: an item on the venue's menus that none of its roots holds any more
//     (but its catalogue still does) is hidden in that venue only, with a till-layer
//     `visible = false` at `venue:<vn_ id>`. The mapping clears it again once a root holds the item.
//
// Pure: no database, no network, no clock.

import type { ChangeSetOp, IntegrationId, SourceRecordId, VenueId } from '@restro/core'

import type { Article, CategoryTreeNode } from '../read/schemas.ts'
import { findCategory, planSections } from './sections.ts'
import { BARSY_MAPPING_VERSION } from './types.ts'
import { flagOf } from './util.ts'

const QUALIFIER = '@'
const SECTION_LINK_ID = /^(\d{1,15})(?:@((?:vn|nd)_[0-9A-Za-z]+))?$/

/** The external id of the section link of category `catId`: plain, or qualified by a menu (or, before D88, a venue). */
export function sectionLinkId(catId: number, qualifier: string | null): string {
  return qualifier === null ? String(catId) : `${catId}${QUALIFIER}${qualifier}`
}

/** The category and the qualifier (null for a plain link) of a section link's external id; null if malformed. */
export function parseSectionLinkId(
  externalId: string,
): { readonly catId: number; readonly qualifier: string | null } | null {
  const match = SECTION_LINK_ID.exec(externalId)
  if (match === null) return null
  return { catId: Number(match[1]), qualifier: match[2] ?? null }
}

/** A stored section link: its external id and the menu its section sits in (null if none found). */
export interface SectionLinkOwner {
  readonly externalId: string
  readonly menuId: string | null
}

/**
 * The qualifier of each category's section link in this menu, for the categories whose link is
 * not the plain one: a link qualified by this menu, or by the venue when that link's section is
 * in this menu (reused as it is), else the menu's id when the plain link belongs to another menu
 * (of this venue or another, or to no menu that can be found). A category that is not in the
 * map uses the plain key.
 */
export function qualifiedSections(
  venueId: string,
  menuId: string,
  links: Iterable<SectionLinkOwner>,
): Map<number, string> {
  const ownByVenue = new Set<number>()
  const ownByMenu = new Set<number>()
  const plainHeldElsewhere = new Set<number>()
  for (const link of links) {
    const parsed = parseSectionLinkId(link.externalId)
    if (parsed === null) continue
    if (parsed.qualifier === menuId) ownByMenu.add(parsed.catId)
    else if (parsed.qualifier === venueId && link.menuId === menuId) ownByVenue.add(parsed.catId)
    else if (parsed.qualifier === null && link.menuId !== menuId) {
      plainHeldElsewhere.add(parsed.catId)
    }
  }
  const qualified = new Map<number, string>()
  for (const catId of plainHeldElsewhere) qualified.set(catId, menuId)
  for (const catId of ownByVenue) qualified.set(catId, venueId)
  for (const catId of ownByMenu) qualified.set(catId, menuId)
  return qualified
}

/** The external ids of the section links whose sections are in this menu. */
export function sectionLinksOfMenu(menuId: string, links: Iterable<SectionLinkOwner>): Set<string> {
  const own = new Set<string>()
  for (const link of links) if (link.menuId === menuId) own.add(link.externalId)
  return own
}

/** True when the category is in the tree (a root the till designates may have gone). */
export function hasCategory(tree: CategoryTreeNode, catId: number): boolean {
  return findCategory(tree, catId) !== null
}

/**
 * Which articles of a read the mapping places in the menu of `rootCatId` (or keeps unplaced in the
 * root itself): the same test `mapCatalogue` applies. Used to read the option groups of the combos
 * of one venue only, when the read holds a whole catalogue. Throws `BarsyMappingError` when the
 * root is not in the tree, as `mapCatalogue` does.
 */
export function inMenuOf(
  tree: CategoryTreeNode,
  rootCatId: number,
  options: { readonly includeServices?: boolean } = {},
): (article: Article) => boolean {
  const plan = planSections(tree, rootCatId, [])
  return (article) => {
    if (flagOf(article.delete_flag) === true) return false
    if (flagOf(article.is_service) === true && options.includeServices !== true) return false
    const categories = (article.categories ?? []).map(Number)
    return categories.some((catId) => plan.sectionOf.has(catId) || catId === rootCatId)
  }
}

/** `inMenuOf` for a venue with several roots (D88): in the menu of any of them. */
export function inMenuOfAny(
  tree: CategoryTreeNode,
  rootCatIds: readonly number[],
  options: { readonly includeServices?: boolean } = {},
): (article: Article) => boolean {
  const tests = rootCatIds.map((root) => inMenuOf(tree, root, options))
  return (article) => tests.some((test) => test(article))
}

/** One item to hide in a venue: its article and the source record the hiding cites. */
export interface VenueHide {
  readonly articleExternalId: string
  readonly sourceRecordId: SourceRecordId | string
}

/**
 * The till-layer writes that hide items in one venue only: `visible = false` at `venue:<vn_ id>`
 * (venue beats master in the till layer). Only ever `false`: hiding, never showing (rule 5).
 */
export function venueHideOps(
  integrationId: IntegrationId | string,
  venueId: VenueId | string,
  hides: readonly VenueHide[],
): ChangeSetOp[] {
  return hides.map((hide) => ({
    op: 'setField',
    node: {
      link: {
        integration: integrationId as IntegrationId,
        externalType: 'article',
        externalId: hide.articleExternalId,
      },
    },
    fieldKey: 'visible',
    layer: 'till',
    scope: `venue:${venueId}`,
    value: false,
    sourceRecordId: hide.sourceRecordId,
    mappingVersion: BARSY_MAPPING_VERSION,
  }))
}
