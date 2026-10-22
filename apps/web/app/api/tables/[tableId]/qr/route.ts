// GET /api/tables/<tb_ id>/qr?format=png|svg: the file behind "Download PNG" and "Download SVG" in
// the Tables & QR tab (brief S3-07). The tenant is the signed-in person's organisation, never the
// request's; a table of another organisation, a table without a code and a made-up id all answer
// 404 alike. Only an owner or admin gets a file: the worker reveals the code (#70). The logic is in
// src/server/tables/download.ts.
import { getPool } from '@/server/db'
import { defaultQrBaseUrl } from '@/server/env'
import { revealConfig, revealFor } from '@/server/reveal'
import { canManageIntegration } from '@/server/roles'
import { getAccess } from '@/server/session'
import { buildQrDownload, parseFormat } from '@/server/tables/download'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tableId: string }> },
): Promise<Response> {
  const access = await getAccess()
  const organization = access?.organization
  if (access === null || organization == null) {
    return new Response('Not signed in', { status: 401 })
  }
  if (!canManageIntegration(organization.role)) return new Response('Not found', { status: 404 })
  const tenantId = organization.id
  const actor = { userId: access.user.id, sessionId: access.sessionId }
  const { tableId } = await params
  const format = parseFormat(new URL(request.url).searchParams.get('format'))
  const file = await buildQrDownload(
    {
      pool: getPool(),
      defaultBaseUrl: defaultQrBaseUrl(),
      reveal: (venueId) => revealFor(revealConfig(), { tenantId, venueId, actor }),
    },
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
