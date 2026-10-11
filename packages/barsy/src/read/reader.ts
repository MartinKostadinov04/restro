// Typed, validated wrappers for the nine allow-listed Stage 2 read methods (rule 7: nothing here
// can write to barsy; the client refuses any method that is not on the read allowlist). Each
// wrapper returns the validated data, the response text byte for byte (`raw`) and the barsy
// request id (null when barsy sent none, e.g. a cached response).
//
// Every method comment names the official doc page it was checked against (CLAUDE.md "barsy
// calls"); the lead's doc check of 2026-10-09 is recorded in ../read-methods.ts, and the request
// parameters below are the ones recorded from the demo installation (fixtures/demo/) unless a
// comment says otherwise.

import type { ZodType } from 'zod'

import type { BarsyBid, BarsyClient } from '../client.ts'
import { BarsyConfigError } from '../errors.ts'
import {
  type Article,
  type ArticleDetailsGroup,
  articleDetailsTreeSchema,
  articlesSchema,
  type CategoryTreeNode,
  type Currency,
  categoryTreeNodeSchema,
  currenciesSchema,
  type Language,
  languagesSchema,
  type Modificator,
  modificatorsSchema,
  type Place,
  placesSchema,
  type SupplementGroup,
  supplementsSchema,
  type Venue,
  venuesSchema,
} from './schemas.ts'

/** What every wrapper returns. */
export interface BarsyReadResult<T> {
  readonly data: T
  /** The response body as text, byte for byte. */
  readonly raw: string
  /** BARSY_REQUEST_ID, or null when barsy sent none (cached responses have none). */
  readonly requestId: string | null
}

/** A page of a list method. */
export interface BarsyPage {
  readonly offset: number
  /** Page size; barsy allows at most 1000 per call and a page must finish within 30 seconds. */
  readonly length: number
}

/**
 * What a page of `Articles_getlist` reads: one venue's menu category (`rootCatId`, sent as
 * `filters.cat_id_deep`: that subtree only), or a whole catalogue (`catalogueId`, sent as
 * `filters.menu_id`: "the catalogue the article belongs to", a documented filter, doc check 10-08,
 * recorded in fixtures/demo/articles-bid*-menu72.json). Exactly one of the two (brief CF-16).
 */
export type BarsyArticlesScope =
  | { readonly rootCatId: number; readonly catalogueId?: undefined }
  | { readonly catalogueId: number; readonly rootCatId?: undefined }

export type BarsyArticlesPage = BarsyPage & BarsyArticlesScope & ArticlesPageOptions

interface ArticlesPageOptions {
  /**
   * Only articles changed after this venue-local time (`YYYY-MM-DD HH:mm:ss`, no offset): sent as
   * `filters.last_update = ">" + time`, as the official guide's first example does
   * (https://docs.lukanet.com/barsy.api/integrations/20-articles.html). The incremental sync's
   * cursor; never the guide's second example (`all_last_update` plus a write into barsy).
   */
  readonly lastUpdateAfter?: string
}

/** barsy's timestamp text in the guide's example: `2012-09-27 17:12:29`. */
const LAST_UPDATE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** The `extra_properties` the full pull asks for, as an object of "1" flags (as recorded). */
export const ARTICLE_EXTRA_PROPERTIES = {
  common: '1',
  // Per-venue for-sale exceptions (`is_for_sale_barsys`): not in the doc's full-pull list.
  limits_by_barsys: '1',
  ml_data: '1',
  description_public: '1',
  picture_url: '1',
  article_details: '1',
  categories: '1',
  has_supplements: '1',
  current_price: '1',
  actual_price: '1',
} as const

/**
 * barsy's own order with a stable tie-break, so offset paging neither skips nor repeats: by the
 * category's weight in the tree (`cat_weight_deep`), then by article id. The brief writes this as
 * "cat_weight_deep asc, article_id asc"; the recordings and the method notes use the object form
 * (`{article_id: 'asc'}`), so the same two keys are sent as an object, in this order. The demo
 * recordings do not cover the first key: confirm it on the next recording.
 */
export const ARTICLES_ORDER_BY = { cat_weight_deep: 'asc', article_id: 'asc' } as const

/**
 * The order of a whole-catalogue read: by article id, as the doc's full pull pages and as the
 * catalogue recordings did. `cat_weight_deep` is limited to a `cat_id_deep` subtree (doc), which a
 * catalogue read does not name; the mapping does not depend on the order.
 */
export const CATALOGUE_ORDER_BY = { article_id: 'asc' } as const

/** The wrappers need only `call`; a test double can be as small as that. */
export type BarsyCaller = Pick<BarsyClient, 'call'>

export interface BarsyReader {
  /** https://docs.lukanet.com/barsy.api/methods/barsys/getlist.html */
  getVenues(): Promise<BarsyReadResult<Venue[]>>
  /** https://docs.lukanet.com/barsy.api/methods/languages/getlist.html */
  getLanguages(): Promise<BarsyReadResult<Language[]>>
  /** https://docs.lukanet.com/barsy.api/methods/currencies/getlist.html */
  getCurrencies(): Promise<BarsyReadResult<Currency[]>>
  /** https://docs.lukanet.com/barsy.api/methods/categories/getalltree.html */
  getCategoryTree(bid: BarsyBid): Promise<BarsyReadResult<CategoryTreeNode>>
  /** https://docs.lukanet.com/barsy.api/methods/articles/getlist.html */
  getArticlesPage(bid: BarsyBid, page: BarsyArticlesPage): Promise<BarsyReadResult<Article[]>>
  /** https://docs.lukanet.com/barsy.api/methods/articlesupplements/get.html */
  getSupplements(
    bid: BarsyBid,
    articleId: number | string,
  ): Promise<BarsyReadResult<SupplementGroup[]>>
  /** https://docs.lukanet.com/barsy.api/methods/modificators/getlist.html */
  getModificatorsPage(bid: BarsyBid, page: BarsyPage): Promise<BarsyReadResult<Modificator[]>>
  /** https://docs.lukanet.com/barsy.api/methods/articledetails/gettree.html */
  getArticleDetailsTree(): Promise<BarsyReadResult<ArticleDetailsGroup[]>>
  /** https://docs.lukanet.com/barsy.api/methods/places/getlist.html */
  getPlaces(bid: BarsyBid): Promise<BarsyReadResult<Place[]>>
}

const MAX_PAGE_LENGTH = 1000

function assertPage(page: BarsyPage): void {
  if (!Number.isSafeInteger(page.offset) || page.offset < 0) {
    throw new BarsyConfigError('barsy page offset must be a non-negative integer')
  }
  if (!Number.isSafeInteger(page.length) || page.length < 1 || page.length > MAX_PAGE_LENGTH) {
    throw new BarsyConfigError(`barsy page length must be an integer from 1 to ${MAX_PAGE_LENGTH}`)
  }
}

function assertCatId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new BarsyConfigError('barsy category id must be a non-negative integer')
  }
}

function assertCatalogueId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new BarsyConfigError('barsy catalogue id must be a non-negative integer')
  }
}

function assertArticleId(id: number | string): string {
  const text = String(id)
  if (!/^[1-9]\d{0,14}$/.test(text)) {
    throw new BarsyConfigError('barsy article id must be a positive integer')
  }
  return text
}

export function createBarsyReader(client: BarsyCaller): BarsyReader {
  async function read<T>(
    method: Parameters<BarsyCaller['call']>[0],
    params: Parameters<BarsyCaller['call']>[1],
    bid: BarsyBid | undefined,
    schema: ZodType<T>,
  ): Promise<BarsyReadResult<T>> {
    const result = await client.call(method, params, { bid, schema })
    return { data: result.data, raw: result.raw, requestId: result.requestId }
  }

  return {
    // The installation's venues; `mode` stays at its default 'restrict' (only venues the API user
    // may access). No `bid`: the list is installation-wide.
    getVenues: () => read('Barsys_getlist', {}, undefined, venuesSchema),

    getLanguages: () => read('Languages_getlist', {}, undefined, languagesSchema),

    getCurrencies: () => read('Currencies_getlist', {}, undefined, currenciesSchema),

    // Always `only_public`: with 0 the demo demands a registered till (a write we never do, D56).
    // `articles_lazy_load_mode` keeps the articles out of the tree; they come from Articles_getlist.
    getCategoryTree: (bid) =>
      read(
        'Categories_getalltree',
        { only_public: '1', articles_lazy_load_mode: '1' },
        bid,
        categoryTreeNodeSchema,
      ),

    // `filters` is required. The subtree filter and the order are the brief's; offset and length
    // are strings like every number the recorder sent.
    getArticlesPage: async (bid, page) => {
      const byCatalogue = page.catalogueId !== undefined
      if (byCatalogue === (page.rootCatId !== undefined)) {
        throw new BarsyConfigError('a barsy article page reads a category or a catalogue, not both')
      }
      if (page.catalogueId !== undefined) assertCatalogueId(page.catalogueId)
      if (page.rootCatId !== undefined) assertCatId(page.rootCatId)
      assertPage(page)
      if (page.lastUpdateAfter !== undefined && !LAST_UPDATE_PATTERN.test(page.lastUpdateAfter)) {
        throw new BarsyConfigError('barsy lastUpdateAfter must look like "YYYY-MM-DD HH:mm:ss"')
      }
      const filters: Record<string, string> =
        page.catalogueId !== undefined
          ? { menu_id: String(page.catalogueId) }
          : { cat_id_deep: String(page.rootCatId) }
      if (page.lastUpdateAfter !== undefined) filters.last_update = `>${page.lastUpdateAfter}`
      return read(
        'Articles_getlist',
        {
          filters,
          order_by: byCatalogue ? CATALOGUE_ORDER_BY : ARTICLES_ORDER_BY,
          extra_properties: ARTICLE_EXTRA_PROPERTIES,
          offset: String(page.offset),
          length: String(page.length),
        },
        bid,
        articlesSchema,
      )
    },

    getSupplements: async (bid, articleId) =>
      read(
        'Articlesupplements_get',
        { article_id: assertArticleId(articleId) },
        bid,
        supplementsSchema,
      ),

    // The default page size is 50, so every call pages explicitly. `categories` is the only extra
    // property the demo recording used.
    getModificatorsPage: async (bid, page) => {
      assertPage(page)
      return read(
        'Modificators_getlist',
        {
          filters: {},
          extra_properties: ['categories'],
          offset: String(page.offset),
          length: String(page.length),
        },
        bid,
        modificatorsSchema,
      )
    },

    getArticleDetailsTree: () =>
      read('Articledetails_gettree', {}, undefined, articleDetailsTreeSchema),

    // `place_num` is documented as an int but arrives as text ("VIP", "Бар"): stored as text.
    getPlaces: (bid) => read('Places_getlist', {}, bid, placesSchema),
  }
}
