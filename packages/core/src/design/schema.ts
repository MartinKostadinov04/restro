import { z } from 'zod'

import {
  DESIGN_PAGES,
  type DesignChoiceOption,
  type DesignValues,
  type PremadeStyleId,
  type StyleValues,
} from './contract'

// The Zod schemas of a design's values and of a Style's, built from the contract so that the record
// (./record.ts), the snapshot's `design` block and the renderer import one thing. Strict: an unknown
// page or option, a missing one or a value outside its list is refused.

type ZodShape = Record<string, z.ZodType>

function pageSchemas(include: (option: DesignChoiceOption) => boolean): ZodShape {
  const pages: ZodShape = {}
  for (const page of DESIGN_PAGES) {
    const shape: ZodShape = {}
    for (const option of page.options) {
      if (option.kind !== 'choice' || !include(option)) continue
      shape[option.id] = z.enum(option.values.map((value) => value.id) as [string, ...string[]])
    }
    pages[page.id] = z.strictObject(shape)
  }
  return pages
}

/** A design's values: one value for every choice option, grouped by page. */
export const DesignValuesSchema = z.strictObject(
  pageSchemas(() => true),
) as unknown as z.ZodType<DesignValues>

/** The values a Style gives: a design's, without the body font (the venue's brand, D128). */
export const StyleValuesSchema = z.strictObject(
  pageSchemas((option) => option.brand !== true),
) as unknown as z.ZodType<StyleValues>

/** The id of a premade Style, from the contract's Style option. */
export const PremadeStyleIdSchema = z.enum(
  (DESIGN_PAGES[0].options[0].values as readonly { id: string }[]).map((value) => value.id) as [
    string,
    ...string[],
  ],
) as unknown as z.ZodType<PremadeStyleId>
