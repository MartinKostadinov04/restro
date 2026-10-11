// Several venues on one installation (brief CF-16, T50, T71). barsy keeps items in catalogues that
// venues can share; each venue of ours shows the part under its own menu category (root). Items
// stay one per article for the installation; what is per venue is written per venue:
//
//   - sections: a category's section link is `category:<catId>` when no such link exists yet or
//     its section is in this venue's menu (so a single venue keeps exactly the links it has), and
//     `category:<catId>@<vn_ id>` otherwise. A venue's existing `@` link is always reused;
//   - absence in one venue: an item on the venue's menu that its root no longer holds (but its
//     catalogue still does) is hidden in that venue only, with a till-layer `visible = false` at
//     `venue:<vn_ id>`. The mapping clears it again once the root holds the item.
//
// Pure: no database, no network, no clock.

import type { ChangeSetOp, IntegrationId, SourceRecordId, VenueId } from '@restro/core'

import type { Article, CategoryTreeNode } from '../read/schemas.ts'
import { planSections } from './sections.ts'
import { BARSY_MAPPING_VERSION } from './types.ts'
import { flagOf } from './util.ts'

const QUALIFIER = '@'
const SECTION_LINK_ID = /^(\d{1,15})(?:@(vn_[0-9A-Za-z]+))?$/

/** The external id of the section link of category `catId`: plain, or qualified by our venue. */
export function sectionLinkId(catId: number, venueId: string | null): string {
  return venueId === null ? String(catId) : `${catId}${QUALIFIER}${venueId}`
}

/** The category and the venue (null for a plain link) of a section link's external id; null if malformed. */
export function parseSectionLinkId(
  externalId: string,
): { readonly catId: number; readonly venueId: string | null } | null {
  const match = SECTION_LINK_ID.exec(externalId)
  if (match === null) return null
  return { catId: Number(match[1]), venueId: match[2] ?? null }
}

/** A stored section link: its external id and the menu its section sits in (null if none found). */
export interface SectionLinkOwner {
  readonly externalId: string
  readonly menuId: string | null
}

/**
 * The categories whose section link in this venue is qualified (`<catId>@<venue>`): those with
 * such a link already, and those whose plain link belongs to a section of another menu (or of no
 * menu we can find). Every other category uses the plain key.
 */
export function qualifiedSections(
  venueId: string,
  menuId: string,
  links: Iterable<SectionLinkOwner>,
): Set<number> {
  const qualified = new Set<number>()
  for (const link of links) {
    const parsed = parseSectionLinkId(link.externalId)
    if (parsed === null) continue
    if (parsed.venueId === venueId) qualified.add(parsed.catId)
    else if (parsed.venueId === null && link.menuId !== menuId) qualified.add(parsed.catId)
  }
  return qualified
}

/** The external ids of the section links whose sections are in this menu. */
export function sectionLinksOfMenu(menuId: string, links: Iterable<SectionLinkOwner>): Set<string> {
  const own = new Set<string>()
  for (const link of links) if (link.menuId === menuId) own.add(link.externalId)
  return own
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
