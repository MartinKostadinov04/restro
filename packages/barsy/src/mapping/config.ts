// Validation of the mapping's configuration and the ids it is handed (Zod at every boundary).
// The error names the offending fields, never their values.

import { ActorSchema, idSchema, type Locale, LocaleSchema } from '@restro/core'
import { z } from 'zod'

import { BarsyMappingError } from './errors.ts'
import { BARSY_MAPPING_VERSION, type CatalogueInput, type MappingConfig } from './types.ts'

/** The change set's name pattern for job ids, profile names and integration ids. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

const mappingConfigSchema = z.strictObject({
  integrationId: idSchema('in'),
  catalogueRootCatId: z.int().nonnegative(),
  priceSource: z.enum(['actual_price', 'current_price']),
  mappingVersion: z.literal(BARSY_MAPPING_VERSION),
  includeServices: z.boolean(),
  jobId: z.string().regex(NAME_PATTERN),
  actor: ActorSchema,
  observedAt: z.iso.datetime({ offset: true }),
  defaultLocale: LocaleSchema.optional(),
  allergenDetailKey: z.string().min(1).max(128).optional(),
})

const inputIdsSchema = z.object({
  venueId: idSchema('vn'),
  menuId: idSchema('nd'),
  bid: z.union([z.int().nonnegative(), z.string().min(1)]),
})

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/** The configuration after validation, with its defaults applied. */
export type ResolvedMappingConfig = MappingConfig & { readonly defaultLocale: Locale }

/** Validates the configuration and applies its defaults. */
export function parseMappingConfig(config: MappingConfig): ResolvedMappingConfig {
  const result = mappingConfigSchema.safeParse(config)
  if (!result.success) {
    throw new BarsyMappingError(
      'invalid_input',
      `invalid mapping configuration: ${describe(result.error)}`,
    )
  }
  return { ...config, defaultLocale: result.data.defaultLocale ?? 'bg_BG' }
}

/** Validates the ids of the input (our venue, our menu root node, the barsy venue). */
export function assertInputIds(input: CatalogueInput): void {
  const result = inputIdsSchema.safeParse(input)
  if (!result.success) {
    throw new BarsyMappingError('invalid_input', `invalid mapping input: ${describe(result.error)}`)
  }
}
