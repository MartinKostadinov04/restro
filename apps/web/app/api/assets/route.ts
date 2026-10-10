// POST /api/assets: upload one image (multipart form, field `file`). The tenant is the signed-in
// person's, never taken from the request. A route handler, not a server action, because actions
// cap the body at 1 MB by default and images may be 10 MB. The logic is in
// src/server/assets/upload-handler.ts.
import { getAssetStore } from '@/server/assets'
import { handleUpload } from '@/server/assets/upload-handler'
import { getPool } from '@/server/db'
import { getAccess } from '@/server/session'

export async function POST(request: Request): Promise<Response> {
  return handleUpload(request, {
    tenantId: async () => (await getAccess())?.organization?.id ?? null,
    pool: getPool(),
    store: getAssetStore,
  })
}
