// An organisation's saved Styles (D129, "My styles"): a named set of design choices the owner keeps
// and applies at any venue of the organisation. A saved Style is the organisation's record, not a
// venue's: `design_styles`, one row each, kept to the organisation by row-level security.
//
// What it carries is `StyleValues`: every choice option but the brand's (the body font), and never
// the colours, the Advanced roles or the logo, which are the venue's own (D128). `style` is the
// premade Style the values came from, kept so a design saved from it still names where it started;
// nothing links back once it is applied.
//
// Only `apply()`'s `setStyle` and `setStyleStatus` operations write these rows (rules 1 and 2).
// Deleting one is a soft removal (`removed_at`): the owner's Undo in the toast is a `setStyleStatus`
// back to `active`, so nothing is ever deleted from app code (D83).

import { z } from 'zod'

import { canonicalJson } from '../hash'
import { idSchema } from '../ids'
import type { DesignChoiceOption, DesignPage, DesignValues, StyleValues } from './contract'
import { DESIGN_PAGES } from './contract'
import { PremadeStyleIdSchema, StyleValuesSchema } from './schema'

/** How long a saved Style's name may be. Longer names are refused, not cut. */
export const SAVED_STYLE_NAME_MAX = 60

/** A saved Style's name: trimmed, at least one character, at most `SAVED_STYLE_NAME_MAX`. */
export const SavedStyleNameSchema = z
  .string()
  .transform((name) => name.trim())
  .refine((name) => name.length >= 1 && name.length <= SAVED_STYLE_NAME_MAX, {
    message: `a style's name is 1 to ${SAVED_STYLE_NAME_MAX} characters`,
  })

/** The id of a saved Style. */
export const SavedStyleIdSchema = idSchema('ds')

/** What a saved Style holds. */
export const SavedStyleContentSchema = z.strictObject({
  name: SavedStyleNameSchema,
  /** The premade Style the values came from. */
  style: PremadeStyleIdSchema,
  values: StyleValuesSchema,
})

/** What a saved Style holds. */
export type SavedStyleContent = z.output<typeof SavedStyleContentSchema>

/** A saved Style as the Design page shows it. */
export interface SavedStyle extends SavedStyleContent {
  readonly id: string
}

/** Whether a saved Style is in the list or soft-removed and waiting for Undo. */
export const STYLE_STATUSES = ['active', 'removed'] as const

/** Whether a saved Style is in the list or soft-removed. */
export type StyleStatus = (typeof STYLE_STATUSES)[number]

export const StyleStatusSchema = z.enum(STYLE_STATUSES)

/**
 * A design's values as a Style carries them: the body font dropped (D128 — it is the venue's
 * brand, like the colours, the roles and the logo). This is what "Save as a style…" stores and what
 * copying another venue's design takes from it.
 */
export function styleValuesOf(values: DesignValues): StyleValues {
  const own: Record<string, Record<string, string>> = {}
  const held = values as unknown as Record<string, Record<string, string>>
  for (const page of DESIGN_PAGES as readonly DesignPage[]) {
    const choices: Record<string, string> = {}
    for (const option of page.options) {
      if (option.kind !== 'choice' || (option as DesignChoiceOption).brand === true) continue
      const value = held[page.id]?.[option.id]
      if (value !== undefined) choices[option.id] = value
    }
    own[page.id] = choices
  }
  return StyleValuesSchema.parse(own)
}

/**
 * A Style's values with the venue's own body font put back: what picking a Style, a saved Style or
 * another venue's design fills the draft's options in with.
 */
export function designValuesOfStyle(style: StyleValues, bodyFont: string): DesignValues {
  const general = { ...(style as { general: Record<string, string> }).general, body_font: bodyFont }
  return { ...style, general } as unknown as DesignValues
}

/** True when two saved Styles hold the same name and the same values. */
export function sameStyle(a: SavedStyleContent, b: SavedStyleContent): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/**
 * The key two names are compared under: a saved Style's name is unique in the organisation among
 * the ones that are not removed, whatever the case or the surrounding space.
 */
export function styleNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('bg-BG')
}
