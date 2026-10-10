// GET /api/assets/file/<key>?exp=…&sig=…: a file of the local asset store (development). With the
// R2 store chosen there is nothing to serve here, and the route answers 404.
import { getLocalAssetStore } from '@/server/assets'
import { serveLocalAsset } from '@/server/assets/serve-local'
import { getAccess } from '@/server/session'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const store = await getLocalAssetStore()
  if (store === null) return new Response(null, { status: 404 })
  const { key } = await params
  const url = new URL(request.url)
  return serveLocalAsset(
    {
      // Keys hold letters, digits and . _ - only; anything else fails the key check as a 404.
      key: key.join('/'),
      exp: url.searchParams.get('exp'),
      sig: url.searchParams.get('sig'),
      tenantId: (await getAccess())?.organization?.id ?? null,
    },
    store,
  )
}
