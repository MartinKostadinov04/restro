// @restro/shell: the population rules R1–R15 that turn (snapshot, live overlay, context) into a
// view model, the palette helper, and the face manifest with its validator. Pure: no I/O, no
// React, no database, no clock. Faces (packages/faces/*) draw the view model and nothing else.
// The contract-test harness is in `@restro/shell/testing`.

export type { Locale } from '@restro/core'
export { buildViewModel } from './build'
export {
  CapabilitiesSchema,
  CHANNELS,
  type Channel,
  DEFAULT_TIME_ZONE,
  IMAGE_VARIANTS,
  type ImageRequest,
  type ImageVariant,
  INTERACTIVE_CHANNELS,
  parseContext,
  type ShellCapabilities,
  type ShellContext,
  type ShellContextInput,
  ShellContextSchema,
  SOLD_OUT_DISPLAYS,
} from './context'
export type { FaceHostProps } from './face-props'
export { SERVICE_KINDS, type ServiceKind } from './features'
export {
  FIELD_FORMATTERS,
  type FieldFormatContext,
  type FormattedField,
  formatField,
  type SnapshotFieldType,
} from './fields'
export { pickVariant } from './images'
export {
  ALLERGEN_MODES,
  COLOUR_NAMES,
  type FaceManifest,
  FaceManifestSchema,
  type FaceOption,
  FEATURE_NAMES,
  type FeatureName,
  imageSlotsFor,
  type ManifestIssue,
  type ManifestResult,
  NO_IMAGE_LAYOUTS,
  OPTION_GROUPS,
  OPTIONAL_SLOTS,
  REQUIRED_SLOTS,
  resolveOptions,
  SLOT_NAMES,
  TOKEN_NAMES,
  validateManifest,
} from './manifest'
export {
  contrastRatio,
  FALLBACK_BRAND,
  generatePalette,
  hexToHsl,
  hslToHex,
  isHexColour,
  MIN_TEXT_CONTRAST,
  PALETTE_STEPS,
  type Palette,
  type PaletteStep,
  readableOn,
  relativeLuminance,
  resolvePalette,
  type SemanticColours,
  semanticColours,
  semanticColoursDark,
} from './palette'
export { type ScheduleStatus, scheduleStatus } from './schedule'
export { type GuestStrings, type Strings, stringsFor } from './strings'
export { fallbackChain, pickText } from './text'
export {
  ITEM_STATES,
  type ItemState,
  type ViewAllergen,
  type ViewBadge,
  type ViewDescription,
  type ViewDietary,
  type ViewExtraField,
  type ViewFeatures,
  type ViewId,
  type ViewImage,
  type ViewItem,
  type ViewModel,
  type ViewModifierGroup,
  type ViewMoney,
  type ViewOption,
  type ViewOrder,
  type ViewPortion,
  type ViewPrice,
  type ViewSchedule,
  type ViewSection,
  type ViewState,
  type ViewTag,
  type ViewText,
  type ViewTheme,
} from './view-model'
