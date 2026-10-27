// GET /api/venues/<vn_ id>/night?day=YYYY-MM-DD: the CSV behind "Download CSV" on the end-of-night
// page (#86; plan `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md` §6). The tenant is
// the signed-in person's organisation, never the request's; a venue of another organisation and a
// made-up id answer 404 alike. Only `night.view_full` (managers and owners) gets a file: staff see
// the page without tips and have no CSV (decision log 3.4), so they get 403. The file is UTF-8
// with a byte-order mark so Excel opens Cyrillic, and holds our ids only (rule 3).
import { CURRENCIES, type Currency, idSchema } from '@restro/core'
import { nightCsv, nightCsvName } from '@restro/core/service'
import { getTranslations } from 'next-intl/server'

import { logError } from '@/server/log'
import { getAccess } from '@/server/session'
import { nightCsvRows } from '@/server/tonight/night-csv'
import { loadNight, loadSentOrders } from '@/server/tonight/night-load'
import { getVenue } from '@/server/venues'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
): Promise<Response> {
  const access = await getAccess()
  const organization = access?.organization
  if (access === null || organization == null) return new Response('Not signed in', { status: 401 })
  const parsedId = idSchema('vn').safeParse((await params).venueId)
  if (!parsedId.success) return new Response('Not found', { status: 404 })
  const day = new URL(request.url).searchParams.get('day') ?? undefined
  if (day !== undefined && !DAY.test(day)) return new Response('Not found', { status: 404 })

  try {
    const venue = await getVenue(organization.id, parsedId.data)
    if (!venue) return new Response('Not found', { status: 404 })
    const scope = {
      tenantId: organization.id,
      venue,
      actor: { kind: 'user' as const, userId: access.user.id, sessionId: access.sessionId },
      sourceNone: (await getTranslations('tonight'))('source_none'),
    }
    const night = await loadNight(scope, day === undefined ? {} : { day })
    if (!night.ok || !night.night.full) return new Response('Forbidden', { status: 403 })
    const sent = await loadSentOrders(scope, { day: night.night.day, limit: 2000 })
    if (!sent.ok) return new Response('Forbidden', { status: 403 })
    const t = await getTranslations('tonight')
    const rows = nightCsvRows(night.night, sent.list.rows, {
      say: (key, values) => t(key as never, values as never),
      source: night.frame.source,
      timezone: night.frame.timezone,
    })
    const currency = (CURRENCIES as readonly string[]).includes(night.frame.currency)
      ? (night.frame.currency as Currency)
      : 'EUR'
    return new Response(nightCsv(rows, currency), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nightCsvName(venue.slug, night.night.day)}"`,
        // Money and who did what: private to the venue's staff.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('tonight_night_csv_failed', error)
    return new Response('Could not make the file', { status: 500 })
  }
}
