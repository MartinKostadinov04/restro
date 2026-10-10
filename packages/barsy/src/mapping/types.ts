// Public types of the barsy mapping (mapping v1): what goes in, what comes out. The mapping is
// pure: no database, no jobs, no network. S2-03 fetches (read wrappers), calls these functions,
// stores the descriptors and hands the change set to apply().

import type {
  Actor,
  ChangeSet,
  IntegrationId,
  Locale,
  NodeId,
  SourceRecordId,
  VenueId,
} from '@restro/core'

import type {
  Article,
  ArticleDetailsGroup,
  CategoryTreeNode,
  Language,
  SupplementGroup,
} from '../read/schemas.ts'

/** The mapping version stamped on every barsy-layer write (doc: "Every write records mapping_version"). */
export const BARSY_MAPPING_VERSION = 1

/** Which barsy price feeds `price` (the open decision P52; both stay in the source record). */
export type PriceSource = 'actual_price' | 'current_price'

/** Versioned mapping configuration for one integration (doc: "versioned configuration, not code paths"). */
export interface MappingConfig {
  readonly integrationId: IntegrationId
  /** The venue's catalogue root (D56): its subtree is the menu, the root itself is the menu root. */
  readonly catalogueRootCatId: number
  readonly priceSource: PriceSource
  readonly mappingVersion: typeof BARSY_MAPPING_VERSION
  /** Map `is_service` articles (cover charge, delivery fee) too. Default false. */
  readonly includeServices: boolean
  /** The job the change set belongs to (a `jb_` job run id). */
  readonly jobId: string
  readonly actor: Actor
  /** When barsy was read, ISO 8601 with an offset. */
  readonly observedAt: string
  /** The language a name without per-language text is stored under. Default `bg_BG`. */
  readonly defaultLocale?: Locale | undefined
  /** The article-detail key mapped to allergens (`k102`); by default found by its name. */
  readonly allergenDetailKey?: string | undefined
}

/** Everything one mapping run reads. Order that is data (tree children, supplement groups and options) is kept; the article list and the other arrays may arrive in any order. */
export interface CatalogueInput {
  /** Our venue (`vn_…`): venue-scoped values are stored under it, never under a barsy `bid`. */
  readonly venueId: VenueId
  /** The barsy venue id the data was read for; selects `is_for_sale_barsys[bid]`. */
  readonly bid: string | number
  /** The menu root node of this venue's menu (created with the venue by `provisionMenu`). */
  readonly menuId: NodeId
  /** `Categories_getalltree` (public tree of this venue): one root node. */
  readonly tree: CategoryTreeNode
  /** All pages of `Articles_getlist` for the catalogue root, concatenated. */
  readonly articles: readonly Article[]
  /** `Articlesupplements_get` per article id (as text), for articles with `has_supplements`. */
  readonly supplementsByArticle: Readonly<Record<string, readonly SupplementGroup[]>>
  /** `Articledetails_gettree`. */
  readonly detailsTree: readonly ArticleDetailsGroup[]
  /** `Languages_getlist`: the languages the installation holds. */
  readonly languages: readonly Language[]
}

/** What kind of barsy object a source record holds. */
export type SourceExternalType =
  | 'category'
  | 'article'
  | 'article_supplements'
  | 'modificator'
  | 'place'

/** The raw object a mapped value came from, ready to be stored as a `source_records` row. */
export interface SourceRecordDescriptor {
  /** Content-addressed (`sr_…`): the same object with the same content always has the same id. */
  readonly id: SourceRecordId
  readonly integrationId: IntegrationId
  readonly externalType: SourceExternalType
  /** The barsy id as text (for `article_supplements`: the article id). */
  readonly externalId: string
  /** `master`, or `venue:<our vn_ id>` for what barsy answers per venue (prices, for sale). */
  readonly scope: 'master' | `venue:${string}`
  /** SHA-256 hex of `raw`. */
  readonly contentHash: string
  /**
   * Canonical JSON of the object as barsy sent it: keys sorted, no whitespace, decimal numbers as
   * their exact text (quoted). Not the response bytes (those are the wrapper's `raw`): hashing
   * the canonical form means a re-ordered key or different spacing is not a new version.
   */
  readonly raw: string
  /** `JSON.parse(raw)`, for the `payload` jsonb column. */
  readonly payload: unknown
}

/** A picture S2-03's fetch job should download: the mapper never fetches and never stores a URL in a field. */
export interface AssetRequest {
  readonly articleExternalId: string
  /** barsy's `picture` (a file name, or a full URL for some articles); a change means a re-fetch. */
  readonly pictureName: string
  readonly url: string
}

/** The barsy object kinds that become source links. */
export type LinkType = 'category' | 'article' | 'supplement_group' | 'supplement'

/**
 * What the link of one barsy object should be after this pull: `active` for every object seen and
 * mapped (also brings a `missing` or `deleted` link back), `deleted` for an article barsy flags
 * with `delete_flag` (the node is hidden, its enrichment kept).
 */
export interface LinkStateIntent {
  readonly linkType: LinkType
  readonly externalId: string
  readonly state: 'active' | 'deleted'
}

export type MappingWarningCode =
  | 'category_flattened'
  | 'section_title_missing'
  | 'article_duplicate'
  | 'article_outside_catalogue'
  | 'article_unplaced'
  | 'item_name_missing'
  | 'price_missing'
  | 'price_invalid'
  | 'allergen_key_not_found'
  | 'allergen_key_ambiguous'
  | 'allergen_detail_unreadable'
  | 'allergen_unknown_word'
  | 'picture_url_invalid'
  | 'supplements_for_unmapped_article'
  | 'modifier_group_max_unknown'
  | 'option_name_missing'
  | 'option_price_invalid'

/** Something the mapping did not guess. Barsy ids only, never names, prices or personal data. */
export interface MappingWarning {
  readonly code: MappingWarningCode
  readonly externalType: SourceExternalType | 'catalogue' | 'supplement_group' | 'supplement'
  readonly externalId: string | null
  /** A short machine-readable detail (an unknown word, a category id). */
  readonly detail?: string
}

export interface CatalogueCounts {
  readonly sections: number
  readonly items: number
  readonly modifierGroups: number
  readonly options: number
  readonly placements: number
  /** Articles barsy flags with `delete_flag`. */
  readonly deletedArticles: number
  /** `is_service` articles left out. */
  readonly skippedServices: number
  /** Articles with no category inside the catalogue. */
  readonly outsideCatalogue: number
}

/** The result of mapping one venue's catalogue. */
export interface CatalogueMapping {
  /** For `apply()`; null when there is nothing to apply (an empty catalogue). */
  readonly changeSet: ChangeSet | null
  /** Every category mapped to a section, every article received, every supplement set: tier 1. */
  readonly sourceRecords: readonly SourceRecordDescriptor[]
  readonly assetRequests: readonly AssetRequest[]
  readonly linkStates: readonly LinkStateIntent[]
  readonly warnings: readonly MappingWarning[]
  readonly counts: CatalogueCounts
}

/** One barsy place, ready to be stored in `places` (the table QR token is S2-03/Stage 3). */
export interface PlaceDescriptor {
  /** barsy's `place_id` as text. */
  readonly placeId: string
  /** barsy's `place_num` as text ("VIP", "Бар", "12"). */
  readonly placeNum: string | null
  readonly salonName: string | null
  readonly isPublic: boolean
  readonly sourceRecord: SourceRecordDescriptor
}
