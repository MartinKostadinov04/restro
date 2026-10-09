// Test data for the mapping tests only (never imported by production code): the real demo
// recordings parsed the way the wrappers parse them, and small builders for synthetic cases.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES_ROOT } from '../fixture-files.ts'
import { parseBarsyJson } from '../json.ts'
import {
  type Article,
  articleDetailsTreeSchema,
  articlesSchema,
  type Category,
  type CategoryTreeNode,
  categoryTreeNodeSchema,
  languagesSchema,
  modificatorsSchema,
  placesSchema,
  type SupplementGroup,
  supplementsSchema,
} from '../read/schemas.ts'
import { deriveId } from './ids.ts'
import type { CatalogueInput, MappingConfig } from './types.ts'

function demo(file: string): unknown {
  const fixture = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'demo', file), 'utf8')) as {
    body: string
  }
  return parseBarsyJson(fixture.body)
}

export const demoTree = categoryTreeNodeSchema.parse(demo('tree-bid10.json'))
export const demoArticles = articlesSchema.parse(demo('articles-bid10-page1.json'))
export const demoBurgerSupplements = supplementsSchema.parse(demo('supplements-7183-burger.json'))
export const demoDetailsTree = articleDetailsTreeSchema.parse(demo('article-details.json'))
export const demoLanguages = languagesSchema.parse(demo('languages.json'))
export const demoPlaces = placesSchema.parse(demo('places-bid10.json'))
export const demoModificators = modificatorsSchema.parse(demo('modificators-bid10.json'))

export const INTEGRATION_ID = deriveId('in', 'test-integration')
export const VENUE_ID = deriveId('vn', 'test-venue')
export const MENU_ID = deriveId('nd', 'test-menu')
export const JOB_ID = deriveId('jb', 'test-job')

/** The demo venue's till catalogue root ("Каса Kiosk"); its public menu root is 1171. */
export const TILL_ROOT = 1091
export const PUBLIC_ROOT = 1171
export const BID = 10

export function config(overrides: Partial<MappingConfig> = {}): MappingConfig {
  return {
    integrationId: INTEGRATION_ID,
    catalogueRootCatId: TILL_ROOT,
    priceSource: 'actual_price',
    mappingVersion: 1,
    includeServices: false,
    jobId: JOB_ID,
    actor: `integration:${INTEGRATION_ID}`,
    observedAt: '2026-10-09T10:00:00+03:00',
    ...overrides,
  }
}

export function input(overrides: Partial<CatalogueInput> = {}): CatalogueInput {
  return {
    venueId: VENUE_ID,
    bid: BID,
    menuId: MENU_ID,
    tree: demoTree,
    articles: demoArticles,
    supplementsByArticle: {},
    detailsTree: demoDetailsTree,
    languages: demoLanguages,
    ...overrides,
  }
}

/** A synthetic article: public, for sale, 2,50, in category 370. Override what the case is about. */
export function article(id: number, overrides: Partial<Article> = {}): Article {
  return {
    article_id: id,
    article_name: `INTERNAL ${id}`,
    article_name_public: `Public ${id}`,
    article_name_public_ml: null,
    description_public: null,
    description_ml: null,
    actual_price: '2.50' as Article['actual_price'],
    current_price: '2.10' as Article['current_price'],
    is_public: 1,
    is_for_sale: 1,
    is_for_sale_barsys: null,
    is_service: 0,
    delete_flag: 0,
    picture: null,
    picture_url: '',
    categories: ['370'],
    article_details: {},
    has_supplements: 0,
    ...overrides,
  }
}

/** A synthetic category tree node. */
export function node(
  catId: number,
  children: CategoryTreeNode[] = [],
  category: Partial<Category> = {},
): CategoryTreeNode {
  return {
    category: {
      cat_id: catId,
      parent_id: null,
      cat_name: `INTERNAL CATEGORY ${catId}`,
      cat_name_public: null,
      cat_name_public_ml: null,
      description_ml: null,
      ...category,
    },
    categories: children,
    articles: null,
    modificators: [],
  }
}

/** The virtual root barsy returns around the real roots. */
export function rootOf(...children: CategoryTreeNode[]): CategoryTreeNode {
  return node(0, children, { cat_id: null })
}

export function group(
  id: number,
  name: string,
  options: { id: number; price: number | string }[],
  overrides: Partial<SupplementGroup> = {},
): SupplementGroup {
  return {
    supplement_group_id: id,
    supplement_group_name: name,
    required: 0,
    max_selected: 1,
    articles: options.map((option) => ({
      article_id: option.id,
      article_name: `INTERNAL OPTION ${option.id}`,
      supplement_price: option.price as never,
    })),
    ...overrides,
  }
}
