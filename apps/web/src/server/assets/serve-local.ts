// Serving a file of the local asset store (app/api/assets/file/[...key]/route.ts wires this).
// A request needs three things: a signed-in person of the file's tenant, a key this module's
// naming builds, and an unexpired signature on that key. Any other file, tenant or tamper is a
// plain 404 or 403 with no detail.
import { type LocalAssetStore, parseAssetKey, verifyAssetLink } from '@restro/assets'

/** What the route knows about the request. */
export interface LocalAssetRequest {
  /** The key from the URL path. */
  readonly key: string
  readonly exp: string | null
  readonly sig: string | null
  /** The tenant of the signed-in person, or null when nobody is signed in. */
  readonly tenantId: string | null
}

const noStore = { 'Cache-Control': 'no-store' }

export async function serveLocalAsset(
  request: LocalAssetRequest,
  store: LocalAssetStore,
  nowMs = Date.now(),
): Promise<Response> {
  if (request.tenantId === null) return new Response(null, { status: 401, headers: noStore })
  const parsed = parseAssetKey(request.key)
  // Another tenant's file looks exactly like a file that does not exist.
  if (parsed === null || parsed.tenantId !== request.tenantId) {
    return new Response(null, { status: 404, headers: noStore })
  }
  if (!verifyAssetLink(store.linkSecret, request.key, request.exp, request.sig, nowMs)) {
    return new Response(null, { status: 403, headers: noStore })
  }
  const bytes = await store.read(request.key)
  if (bytes === null) return new Response(null, { status: 404, headers: noStore })

  const remaining = Math.max(0, Number(request.exp) - Math.floor(nowMs / 1000))
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': parsed.contentType,
      'Content-Length': String(bytes.length),
      // The same link works until it expires; the bytes under a key never change.
      'Cache-Control': `private, max-age=${remaining}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // An image needs no script or style: if the file were ever something else, it runs nothing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
