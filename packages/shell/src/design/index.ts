// The design contract and its schemas live in core (the design record, the snapshot schema and the
// leak guard check against them); the shell re-exports them for faces, beside the Style files.
export {
  DESIGN_MARKER,
  DESIGN_MARKER_PAGES,
  DESIGN_OPTIONS,
  DESIGN_PAGES,
  DESIGN_TOKEN,
  DESIGN_TOKEN_MAX,
  type DesignChoiceOption,
  type DesignColoursOption,
  type DesignLabel,
  type DesignOption,
  type DesignPage,
  type DesignPageEntry,
  type DesignPageId,
  type DesignStyleOption,
  type DesignValue,
  type DesignValues,
  DesignValuesSchema,
  type PremadeStyleId,
  PremadeStyleIdSchema,
  type StyleValues,
  StyleValuesSchema,
} from '@restro/core'
export { type StyleFile, StyleFileSchema } from './style'
export { PREMADE_STYLES } from './styles'
