// barsy API credentials as a sealed envelope (`integrations.credentials_sealed`). The web seals
// what the manager types (S2-05); only the worker opens it (`openBarsyCredentials`).

import type { KeyObject } from 'node:crypto'

import { z } from 'zod'

import type { IntegrationSealContext } from './envelope'
import { SealError } from './errors'
import { sealSecret } from './seal'

/** One barsy API user (rule 9: one per integration per environment). */
export const BarsyCredentialsSchema = z.strictObject({
  user: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
})

/** A barsy API user's name and password. */
export type BarsyCredentials = z.output<typeof BarsyCredentialsSchema>

/** Seals barsy credentials for the worker, bound to the integration's tenant, id and host. */
export function sealBarsyCredentials(
  credentials: BarsyCredentials,
  context: IntegrationSealContext & { readonly publicKey: KeyObject | string },
): string {
  const parsed = BarsyCredentialsSchema.safeParse(credentials)
  if (!parsed.success) {
    // Never the values: only which part is wrong.
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) =>
          issue.path.length > 0 ? String(issue.path[0]) : 'credentials',
        ),
      ),
    ]
    throw new SealError('invalid_payload', `invalid barsy credentials: ${fields.join(', ')}`)
  }
  return sealSecret(context.publicKey, JSON.stringify(parsed.data), context)
}
