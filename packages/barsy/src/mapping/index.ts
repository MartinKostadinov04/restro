// The barsy mapping (v1): pure functions from barsy responses to source-record descriptors and a
// change set for apply(). No database, no jobs, no network.

export { parseAllergenText } from './allergens.ts'
export { type ArticlePicture, mapCatalogue, readArticlePicture } from './catalogue.ts'
export { DEFAULT_MAPPING_LOCALE } from './config.ts'
export { BarsyMappingError, type BarsyMappingErrorCode } from './errors.ts'
export { mapModificators, mapPlaces, type PlacesContext } from './places.ts'
export {
  type AssetRequest,
  BARSY_MAPPING_VERSION,
  type CatalogueCounts,
  type CatalogueInput,
  type CatalogueMapping,
  type LinkStateIntent,
  type LinkType,
  type MappingConfig,
  type MappingWarning,
  type MappingWarningCode,
  type PlaceDescriptor,
  type PriceSource,
  type SourceExternalType,
  type SourceRecordDescriptor,
} from './types.ts'
export {
  inMenuOf,
  parseSectionLinkId,
  qualifiedSections,
  type SectionLinkOwner,
  sectionLinkId,
  sectionLinksOfMenu,
  type VenueHide,
  venueHideOps,
} from './venues.ts'
