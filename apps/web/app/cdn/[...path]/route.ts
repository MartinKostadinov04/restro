// GET /cdn/<path>: the published menus and photo variants of the LOCAL publish store, with the
// cache headers the CDN will send later (src/server/publish/cdn.ts). Public by design: no session.
// With `PUBLISH_STORE=r2` there is nothing to serve here and the route answers 404.
import { serveCdn } from '@/server/publish/cdn'
import { getLocalPublishStore } from '@/server/publish/store'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  // The store accepts only the four shapes of file; anything else (including `..`) is a 404.
  return serveCdn(path.join('/'), await getLocalPublishStore())
}
