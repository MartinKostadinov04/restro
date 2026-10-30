// POST /api/assets: upload one image (multipart form, field `file`). The tenant is the signed-in
// person's, never taken from the request. A route handler, not a server action, because actions
// cap the body at 1 MB by default and images may be 10 MB. The logic is in
// src/server/assets/upload-handler.ts.
import { type AssetId, JOB_NAMES, type TenantId } from '@restro/core'

import { getAssetStore } from '@/server/assets'
import { handleUpload } from '@/server/assets/upload-handler'
import { getPool } from '@/server/db'
import { enqueueJob } from '@/server/jobs'
import { getAccess } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'

export async function POST(request: Request): Promise<Response> {
  const access = await getAccess()
  return handleUpload(request, {
    tenantId: async () => access?.organization?.id ?? null,
    sharedDevice: async (tenantId) =>
      access !== null && (await onSharedDevice({ tenantId, sessionId: access.sessionId })),
    pool: getPool(),
    store: getAssetStore,
    // The phone-sized webp variants are made by the worker.
    queueVariants: (tenantId, assetId) =>
      enqueueJob(JOB_NAMES.assetVariants, {
        tenantId: tenantId as TenantId,
        assetId: assetId as AssetId,
      }),
  })
}
