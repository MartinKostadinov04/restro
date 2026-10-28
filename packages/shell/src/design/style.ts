import { z } from 'zod'

import type { PremadeStyleId, StyleValues } from './contract'
import { PremadeStyleIdSchema, StyleValuesSchema } from './schema'

// The Style file (D127): how one of Restro's premade Styles is written. One file per Style in
// ./styles/, named for its id, holding one value for every option that a Style sets: no colours, no
// Advanced roles, no logo and no body font, which are the venue's brand. A header lists every way
// the Style departs from the look it reproduces ("none" for a Style that reproduces nothing).
// scripts/design-contract.test.ts checks every file against the contract.

/** One premade Style. */
export interface StyleFile {
  readonly id: PremadeStyleId
  /** How this Style differs from the look it reproduces, one line each; empty when it reproduces none. */
  readonly departures: readonly string[]
  readonly values: StyleValues
}

export const StyleFileSchema: z.ZodType<StyleFile> = z.strictObject({
  id: PremadeStyleIdSchema,
  departures: z.array(z.string().min(1)),
  values: StyleValuesSchema,
})
