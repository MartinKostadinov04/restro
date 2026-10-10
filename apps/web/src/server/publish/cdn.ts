// Serving the local publish store at `/cdn/...` (brief S3-01b; app/cdn/[...path]/route.ts wires
// this). It stands in for the CDN in development: the same four shapes of file with the same
// `Cache-Control` rules (@restro/assets, publish-paths.ts), so a guest page reads from `/cdn` today
// and from the CDN in staging by changing one base address.
//
// No session is needed, by design: everything in the publish store is public and holds nothing
// internal (S3-01a's snapshot leak guard); an original photo or any other private file cannot be
// put there (the store refuses such paths) and cannot be asked for here (the same four shapes are
// the only paths served). Any other path, a missing file or a path with `..` in it is a plain 404.
import {
  type PublishStore,
  parsePublishPath,
  publishCacheControl,
  publishContentType,
} from '@restro/assets'

/** A 404 must not be cached by a CDN or a browser: the file may be published a moment later. */
const NOT_FOUND = { 'Cache-Control': 'no-store' }

/**
 * The response for `/cdn/<path>`. `store` is the local publish store, or null when the process
 * publishes elsewhere (`PUBLISH_STORE=r2`): then there is nothing to serve here.
 */
export async function serveCdn(path: string, store: PublishStore | null): Promise<Response> {
  if (store === null || parsePublishPath(path) === null) {
    return new Response(null, { status: 404, headers: NOT_FOUND })
  }
  const bytes = await store.get(path)
  if (bytes === null) return new Response(null, { status: 404, headers: NOT_FOUND })
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': publishContentType(path),
      'Content-Length': String(bytes.length),
      'Cache-Control': publishCacheControl(path),
      'X-Content-Type-Options': 'nosniff',
      // A snapshot or an image needs no script or style: if the file were ever something else,
      // it runs nothing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
