import { z } from 'zod'

import {
  DESIGN_PAGES,
  type DesignChoiceOption,
  type DesignPage,
  type DesignValues,
  type PremadeStyleId,
  type StyleValues,
} from './contract'

// The Zod schemas of a design's values and of a Style's, built from the contract so that the record
// (./record.ts), the snapshot's `design` block and the renderer import one thing. Strict: an unknown
// page or option, a missing one or a value outside its list is refused.
//
// Everything STORED is written against the strict schema, and only against it: `setDesign` saves a
// record, the publisher writes the snapshot's `design` block. Everything READ goes through
// `readDesignValues` below, which never refuses a block: the option list is a contract that keeps
// moving (an option added, removed or renamed is a normal change, D130), and a published snapshot
// or a stored record is read long after it was written. A strict read would mean that the first
// change to the list broke every published menu and every admin read of it until the venue
// republished — and the republish reads the previous snapshot too, so there would be no way out
// but a code change (designer audit DA-15).

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

/** The choice options of a page, with the value each one enters with (D130: its first). */
function choicesOf(page: DesignPage): [DesignChoiceOption, string][] {
  return page.options.flatMap((option) =>
    option.kind === 'choice' ? [[option, option.values[0].id] as [DesignChoiceOption, string]] : [],
  )
}

/** Whether `value` is a plain object (a page of a stored block, or the block itself). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The first value of every choice option, page by page: the values of Basic (D130). Built here
 * rather than in ./record.ts because the lenient read falls back to them; `BASIC_DESIGN_VALUES`
 * is this, re-exported where the rest of the code already looks for it.
 */
export const FIRST_DESIGN_VALUES: DesignValues = DesignValuesSchema.parse(
  Object.fromEntries(DESIGN_PAGES.map((page) => [page.id, Object.fromEntries(choicesOf(page))])),
)

/**
 * A design's values as READ, from a block written against any version of the option list: every
 * option the contract lists now, with the stored value when it is still one of that option's
 * values, else the fallback's (the venue's Style where the caller has it, otherwise Basic — D130:
 * an option enters at its first value, so a block saved before it keeps its look). An option or a
 * page the contract no longer lists is dropped, and anything that is not a block at all reads as
 * the fallback. Never throws, and always gives a whole, drawable design: `DesignValuesSchema`
 * accepts what comes back.
 */
export function readDesignValues(
  stored: unknown,
  fallback: DesignValues = FIRST_DESIGN_VALUES,
): DesignValues {
  const block = isRecord(stored) ? stored : {}
  const values: Record<string, Record<string, string>> = {}
  for (const page of DESIGN_PAGES) {
    const storedPage = block[page.id]
    const own = isRecord(storedPage) ? storedPage : {}
    const fallbackPage = (fallback as unknown as Record<string, Record<string, string>>)[page.id]
    const choices: Record<string, string> = {}
    for (const [option, first] of choicesOf(page)) {
      const listed = (value: unknown) => option.values.some((entry) => entry.id === value)
      const value = own[option.id]
      const spare = fallbackPage?.[option.id]
      // The fallback is checked as well: a caller may pass a block of unknown provenance.
      choices[option.id] = listed(value)
        ? (value as string)
        : listed(spare)
          ? (spare as string)
          : first
    }
    values[page.id] = choices
  }
  // Belt and braces: every value above is one the contract lists, so this never falls through.
  const parsed = DesignValuesSchema.safeParse(values)
  return parsed.success ? parsed.data : FIRST_DESIGN_VALUES
}

/** The id of a premade Style, from the contract's Style option. */
export const PremadeStyleIdSchema = z.enum(
  (DESIGN_PAGES[0].options[0].values as readonly { id: string }[]).map((value) => value.id) as [
    string,
    ...string[],
  ],
) as unknown as z.ZodType<PremadeStyleId>
