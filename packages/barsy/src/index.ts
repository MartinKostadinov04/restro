// @restro/barsy: the typed, read-only barsy client (CLAUDE.md rule 7: sync never writes into barsy).
// Only apps/worker imports this package. Test helpers live in `@restro/barsy/testing`; the fixture
// recorder behind `pnpm barsy:record` is a script. Neither is exported from here.

export type {
  BarsyBid,
  BarsyCallMap,
  BarsyCallOptions,
  BarsyCallSpec,
  BarsyClient,
  BarsyClientOptions,
  BarsyManyData,
  BarsyParams,
  BarsyRawResponse,
  BarsyResult,
  JsonValue,
} from './client.ts'
export { createBarsyClient } from './client.ts'
export type { BarsyClientConfig, BarsyClientConfigInput } from './config.ts'
export {
  BARSY_TIMEOUT_MS,
  barsyClientConfigSchema,
  loadBarsyConfig,
  parseClientConfig,
} from './config.ts'
export type { BarsyCallContext, BarsyIssue } from './errors.ts'
export {
  BarsyAuthError,
  BarsyCallError,
  BarsyConfigError,
  BarsyError,
  BarsyHostNotAllowedError,
  BarsyHttpError,
  BarsyMethodNotAllowedError,
  BarsyNetworkError,
  BarsyResponseError,
  BarsyTimeoutError,
} from './errors.ts'
export type { BarsyEnv } from './hosts.ts'
export {
  assertHostAllowed,
  BARSY_DEMO_HOST,
  BARSY_ENVS,
  barsyEnvSchema,
  normaliseHost,
  parseAllowedHosts,
} from './hosts.ts'
export type { DecimalString } from './json.ts'
export { asDecimalString, hasJsonSourceAccess, isDecimalText, parseBarsyJson } from './json.ts'
export type {
  ArticlePicture,
  AssetRequest,
  BarsyMappingErrorCode,
  CatalogueCounts,
  CatalogueInput,
  CatalogueMapping,
  LinkStateIntent,
  LinkType,
  MappingConfig,
  MappingWarning,
  MappingWarningCode,
  PlaceDescriptor,
  PlacesContext,
  PriceSource,
  SectionLinkOwner,
  SourceExternalType,
  SourceRecordDescriptor,
  VenueHide,
} from './mapping/index.ts'
export {
  BARSY_MAPPING_VERSION,
  BarsyMappingError,
  DEFAULT_MAPPING_LOCALE,
  hasCategory,
  inMenuOf,
  inMenuOfAny,
  mapCatalogue,
  mapModificators,
  mapPlaces,
  parseAllergenText,
  parseSectionLinkId,
  qualifiedSections,
  readArticlePicture,
  sectionLinkId,
  sectionLinksOfMenu,
  venueHideOps,
} from './mapping/index.ts'
export type {
  BarsyArticlesPage,
  BarsyArticlesScope,
  BarsyCaller,
  BarsyPage,
  BarsyReader,
  BarsyReadResult,
} from './read/reader.ts'
export {
  ARTICLE_EXTRA_PROPERTIES,
  ARTICLES_ORDER_BY,
  CATALOGUE_ORDER_BY,
  createBarsyReader,
} from './read/reader.ts'
export type {
  Article,
  ArticleDetailsGroup,
  BarsyNumber,
  Category,
  CategoryTreeNode,
  Currency,
  Language,
  Modificator,
  Place,
  SupplementGroup,
  SupplementOption,
  Venue,
} from './read/schemas.ts'
export {
  articleDetailsTreeSchema,
  articleSchema,
  articlesSchema,
  barsyNumberSchema,
  categorySchema,
  categoryTreeNodeSchema,
  currenciesSchema,
  currencySchema,
  languageSchema,
  languagesSchema,
  modificatorSchema,
  modificatorsSchema,
  placeSchema,
  placesSchema,
  supplementGroupSchema,
  supplementOptionSchema,
  supplementsSchema,
  venueSchema,
  venuesSchema,
} from './read/schemas.ts'
export type { BarsyReadMethod } from './read-methods.ts'
export {
  BARSY_READ_METHOD_NAMES,
  BARSY_READ_METHODS,
  barsyMethodAuth,
  isBarsyReadMethod,
} from './read-methods.ts'
export { BARSY_SERVICE_CAPABILITIES } from './service/capabilities.ts'
export type { BarsyServiceReaderOptions } from './service/reader.ts'
export { createBarsyServiceReader } from './service/reader.ts'
export { BARSY_WAITER_ACTIONS } from './service/waiter-actions.ts'
