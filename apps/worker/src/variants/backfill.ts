// The one-off backfill of photo variants (brief S3-01b): photos stored before variants existed, or
// whose `asset-variants` job never finished, get theirs. It runs in-process, one photo at a time
// (a worker is not needed), and finds only the stored assets with no recorded variants, so it is
// safe to run again: a second run finds nothing to do. Run it with
// `pnpm --filter @restro/worker variants:backfill`.
import { authOrganization, type DbPool, withSystem } from '@restro/db'

import type { Logger } from '../logger'
import { assetsWithoutVariants, runAssetVariants, type VariantsDeps } from '../publish/variants'

export interface BackfillSummary {
  /** Assets that had no variants when the run found them. */
  readonly found: number
  readonly made: number
  readonly skipped: number
  /** Assets whose variants could not be made (the original is missing, an I/O error …). */
  readonly failed: number
}

/** Assets are read this many at a time per tenant. */
const PAGE = 100

export async function backfillVariants(
  deps: VariantsDeps & { readonly log: Logger; readonly pool: DbPool },
): Promise<BackfillSummary> {
  const tenants = await withSystem(deps.pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const summary = { found: 0, made: 0, skipped: 0, failed: 0 }
  for (const tenant of tenants) {
    // Walk by id: an asset that cannot be made stays "without variants" and must not be asked for
    // again in the same run.
    let afterId: string | undefined
    for (;;) {
      const ids = await assetsWithoutVariants(deps.pool, tenant.id, {
        limit: PAGE,
        ...(afterId === undefined ? {} : { afterId }),
      })
      if (ids.length === 0) break
      for (const assetId of ids) {
        summary.found += 1
        try {
          const result = await runAssetVariants(deps, { tenantId: tenant.id, assetId })
          if (result.status === 'made') summary.made += 1
          else summary.skipped += 1
        } catch (error) {
          summary.failed += 1
          deps.log.warn({ err: error, assetId }, 'the variants of a photo could not be made')
        }
      }
      afterId = ids.at(-1)
    }
  }
  return summary
}
