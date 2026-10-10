// GET /api/tables/<tb_ id>/qr?format=png|svg: the file behind "Download PNG" and "Download SVG" in
// the Tables & QR tab (brief S3-07). The tenant is the signed-in person's organisation, never the
// request's; a table of another organisation, a table without a code and a made-up id all answer
// 404 alike. The logic is in src/server/tables/download.ts.
import { getPool } from '@/server/db'
import { defaultQrBaseUrl } from '@/server/env'
import { getAccess } from '@/server/session'
import { buildQrDownload, parseFormat } from '@/server/tables/download'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tableId: string }> },
): Promise<Response> {
  const tenantId = (await getAccess())?.organization?.id
  if (tenantId === undefined) return new Response('Not signed in', { status: 401 })
  const { tableId } = await params
  const format = parseFormat(new URL(request.url).searchParams.get('format'))
  const file = await buildQrDownload(
    { pool: getPool(), defaultBaseUrl: defaultQrBaseUrl() },
    tenantId,
    tableId,
    format,
  )
  if (!file.ok) return new Response('Not found', { status: 404 })
  return new Response(file.body as BodyInit, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      // A code is private to the venue's staff until it is printed.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
