// The design record (D129): one per venue, at `venues.settings.design`. It holds a value for every
// choice option of the contract (D130), the venue's three colours and the Advanced roles (D70), the
// logo, the Style it came from, a revision and the provenance of the write that stored it. It
// replaced `venues.settings.theme` and `presentation` and absorbed the menus' layout and guest
// switch (migration 0043); a section's own layout stays a field on the section.
//
// Only `apply()`'s `setDesign` operation writes it (rules 1 and 2), with the revision it expects
// (a stale one is refused); scripts/design-writers.test.ts holds that. Nothing is derived into
// storage: the palette, the roles and the snapshot's theme tokens are worked out at publish
// (`designThemeOf`), so a better derivation reaches every venue with its next publish.

import { z } from 'zod'

import { canonicalJson } from '../hash'
import { idSchema } from '../ids'
import { AssetIdSchema } from '../snapshot/schema'
import type { ThemeFontId } from '../theme/fonts'
import {
  HexInputSchema,
  RoleOverridesSchema,
  ThemeColoursSchema,
  type VenueTheme,
} from '../theme/settings'
import { DESIGN_PAGES, type DesignValues, type PremadeStyleId } from './contract'
import { DesignValuesSchema, PremadeStyleIdSchema } from './schema'

/** The key of `venues.settings` the record is stored under. */
export const DESIGN_SETTINGS_KEY = 'design'

/** What a design save carries: everything of the record but its revision and provenance. */
const designContentShape = {
  /** The Style the values came from (D128); nothing links back to it after it is picked. */
  style: PremadeStyleIdSchema,
  /** A value for every choice option of the contract. */
  values: DesignValuesSchema,
  /** The venue's three colours (D70). */
  colors: ThemeColoursSchema.optional(),
  /**
   * The one brand colour of a venue that never set three (the theme's v1 shape), carried by the
   * migration so it draws as before; never set beside `colors`.
   */
  brand: HexInputSchema.optional(),
  /** Roles set by hand in Advanced, per scheme. */
  overrides: RoleOverridesSchema.optional(),
  /** The logo, or null for none. */
  logo_asset_id: AssetIdSchema.nullable(),
}

const notBrandAndColours = (content: { colors?: unknown; brand?: unknown }) =>
  content.colors === undefined || content.brand === undefined

/** A design as a save carries it (the `setDesign` operation's `design`). */
export const DesignContentSchema = z
  .strictObject(designContentShape)
  .refine(notBrandAndColours, 'a design has either three colours or one brand colour, not both')

/** A design as a save carries it. */
export type DesignContent = z.output<typeof DesignContentSchema>

/**
 * Who stored the record (rule 2): the manual layer and source (a design is the venue's own, never a
 * till's), the actor (the member who saved it, or `system` for migration 0043) and the job. The
 * actor's pattern is change-set.ts's, narrowed to the two actors a design has; it is written out
 * here because the change set imports this file.
 */
export const DesignProvenanceSchema = z.strictObject({
  layer: z.literal('manual'),
  source: z.literal('manual'),
  actor: z
    .string()
    .regex(/^(?:system|user:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$/, 'expected an actor'),
  job_id: z.string().min(1).max(128),
  /** The change set that saved it; null for the record migration 0043 wrote. */
  change_set_id: idSchema('cs').nullable(),
})

/** Who stored the record. */
export type DesignProvenance = z.output<typeof DesignProvenanceSchema>

/** The stored record. */
export const DesignRecordSchema = z
  .strictObject({
    ...designContentShape,
    /** 1 for the first record, one more with every save. */
    revision: z.int().min(1),
    provenance: DesignProvenanceSchema,
  })
  .refine(notBrandAndColours, 'a design has either three colours or one brand colour, not both')

/** The stored record. */
export type DesignRecord = z.output<typeof DesignRecordSchema>

/** Basic's values (D130: the first value of each row), built from the contract. */
function firstValues(): DesignValues {
  const values: Record<string, Record<string, string>> = {}
  for (const page of DESIGN_PAGES) {
    const choices: Record<string, string> = {}
    for (const option of page.options) {
      if (option.kind === 'choice') choices[option.id] = option.values[0].id
    }
    values[page.id] = choices
  }
  return DesignValuesSchema.parse(values)
}

/** The values of a design on Basic. */
export const BASIC_DESIGN_VALUES: DesignValues = firstValues()

/** The design of a venue with no record: Basic, no colours, no logo (D128: every venue starts on Basic). */
export const DEFAULT_DESIGN: DesignContent = Object.freeze({
  style: 'basic' as PremadeStyleId,
  values: BASIC_DESIGN_VALUES,
  logo_asset_id: null,
})

/** A venue's design as read: the record's content and revision (0 when it has none yet). */
export interface StoredDesign {
  readonly revision: number
  readonly design: DesignContent
}

/** The value of `venues.settings.design`, or undefined. */
function storedValue(settings: unknown): unknown {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined
  return Object.hasOwn(settings, DESIGN_SETTINGS_KEY)
    ? (settings as Record<string, unknown>)[DESIGN_SETTINGS_KEY]
    : undefined
}

/**
 * A stored record's values with every option it lacks set to Basic's: an option added to the
 * contract after the record was saved reads as its first value (D130's first value is the one a new
 * option enters with, so a record saved before it keeps its look). Anything else is left to the
 * strict schema.
 */
function withNewOptions(stored: unknown): unknown {
  if (typeof stored !== 'object' || stored === null || !('values' in stored)) return stored
  const values = (stored as { values: unknown }).values
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return stored
  const filled: Record<string, unknown> = { ...(values as Record<string, unknown>) }
  for (const [page, basic] of Object.entries(BASIC_DESIGN_VALUES)) {
    const own = filled[page]
    if (own === undefined) filled[page] = basic
    else if (typeof own === 'object' && own !== null && !Array.isArray(own)) {
      filled[page] = { ...basic, ...own }
    }
  }
  return { ...stored, values: filled }
}

/** The record as stored, or null when the venue has none or the stored value is not valid. */
export function readDesignRecord(settings: unknown): DesignRecord | null {
  const parsed = DesignRecordSchema.safeParse(withNewOptions(storedValue(settings)))
  return parsed.success ? parsed.data : null
}

/**
 * Whether the venue holds a design that is not a valid record: a value or an option later removed
 * from the contract, or a hand-edited row. The publisher refuses such a venue (`invalid_design`)
 * rather than publish it as Basic.
 */
export function hasInvalidDesign(settings: unknown): boolean {
  return storedValue(settings) !== undefined && readDesignRecord(settings) === null
}

/**
 * A venue's design from its `settings`: the record's content and revision, or Basic at revision
 * 0 when it has none. A stored value that is not a valid record (`hasInvalidDesign`) reads as Basic
 * here, for the editor, but keeps its revision, so the next save replaces it rather than being
 * refused as stale forever. Publishing it is refused.
 */
export function readDesign(settings: unknown): StoredDesign {
  const record = readDesignRecord(settings)
  if (record !== null) return { revision: record.revision, design: designContentOf(record) }
  const stored = storedValue(settings)
  const revision =
    typeof stored === 'object' && stored !== null && 'revision' in stored
      ? (stored as { revision: unknown }).revision
      : 0
  return {
    revision: Number.isSafeInteger(revision) && (revision as number) > 0 ? (revision as number) : 0,
    design: DEFAULT_DESIGN,
  }
}

/** The content of a record: without its revision and provenance. */
export function designContentOf(record: DesignRecord | DesignContent): DesignContent {
  const { style, values, colors, brand, overrides, logo_asset_id } = record
  return {
    style,
    values,
    ...(colors === undefined ? {} : { colors }),
    ...(brand === undefined ? {} : { brand }),
    ...(overrides === undefined ? {} : { overrides }),
    logo_asset_id,
  }
}

/** General's Corners words as the snapshot theme's radius, in px (`theme.radius`). */
export const CORNER_RADIUS: { readonly [W in DesignValues['general']['corners']]: number } = {
  soft: 8,
  square: 0,
  round: 16,
  extra: 24,
}

/** General's Depth words as the snapshot theme's shadow strength (`theme.shadow`). */
export const DEPTH_SHADOW: { readonly [W in DesignValues['general']['depth']]: number } = {
  low: 1,
  none: 0,
}

/** The word of `table` nearest to `amount`; a tie goes to the larger step. */
function nearestWord<W extends string>(table: { readonly [K in W]: number }, amount: number): W {
  const entries = (Object.entries(table) as [W, number][]).sort((a, b) => a[1] - b[1])
  let best = entries[0] as [W, number]
  for (const entry of entries) {
    if (Math.abs(entry[1] - amount) <= Math.abs(best[1] - amount)) best = entry
  }
  return best[0]
}

/** The Corners word nearest to a radius in px (how migration 0043 mapped the old slider). */
export function cornersOfRadius(radius: number): DesignValues['general']['corners'] {
  return nearestWord(CORNER_RADIUS, radius)
}

/** The Depth word nearest to a shadow strength (how migration 0043 mapped the old slider). */
export function depthOfShadow(shadow: number): DesignValues['general']['depth'] {
  return nearestWord(DEPTH_SHADOW, shadow)
}

/**
 * The look a design publishes, in the theme's terms: its colours, roles and logo, its body font,
 * the px of its corners and depth words and its screen. `snapshotThemeOf` (apply/publish.ts)
 * turns it into the snapshot's theme tokens, deriving the palette and roles there.
 */
export function designThemeOf(design: DesignContent): VenueTheme {
  const general = design.values.general
  return {
    ...(design.brand === undefined ? {} : { brand: design.brand }),
    logo_asset_id: design.logo_asset_id,
    ...(design.colors === undefined ? {} : { colors: design.colors }),
    ...(design.overrides === undefined ? {} : { overrides: design.overrides }),
    font: general.body_font as ThemeFontId,
    radius: CORNER_RADIUS[general.corners],
    shadow: DEPTH_SHADOW[general.depth],
    scheme: general.screen,
  }
}

/** True when two designs hold the same content (a save that changes nothing). */
export function sameDesign(a: DesignContent, b: DesignContent): boolean {
  return canonicalJson(designContentOf(a)) === canonicalJson(designContentOf(b))
}
