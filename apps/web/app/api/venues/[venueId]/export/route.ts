// GET /api/venues/<vn_ id>/export?kind=sent|log&from=YYYY-MM-DD&to=YYYY-MM-DD: the two files behind
// "Export" in Tonight › Log (#87; plan `docs/deliverables/2026-10-27-settings-alerts-export-plan.md`
// §B): the sent orders, or the Log, of a range of service days, each one CSV in the end-of-night
// CSV's format (UTF-8 with a byte-order mark so Excel opens Cyrillic; amounts through the money
// module; our ids only, no POS id and no guest data). The tenant is the signed-in person's
// organisation, never the request's; a venue of another organisation and a made-up id answer 404
// alike. Only a role holding `log.view` and `night.view_full` gets a file (403 otherwise). A range
// wider than what the venue still holds downloads what is held.
import { CURRENCIES, type Currency, idSchema } from '@restro/core'
import { nightCsv, readExportDays } from '@restro/core/service'
import { getLocale, getTranslations } from 'next-intl/server'

import { toDataLocale } from '@/i18n/locales'
import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { getAccess } from '@/server/session'
import { logExportRows, sentExportRows } from '@/server/tonight/export-csv'
import { loadLog, loadSentOrders, type NightScope } from '@/server/tonight/night-load'
import { getVenue } from '@/server/venues'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The file's name: `restro-{venue}-{sent-orders|log}-{from}_{to}.csv`. */
function fileName(slug: string, kind: 'sent' | 'log', from: string, to: string): string {
  const what = kind === 'sent' ? 'sent-orders' : 'log'
  return `restro-${slug.replace(/[^A-Za-z0-9_-]/g, '-')}-${what}-${from}_${to}.csv`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
): Promise<Response> {
  const access = await getAccess()
  const organization = access?.organization
  if (access === null || organization == null) return new Response('Not signed in', { status: 401 })
  const parsedId = idSchema('vn').safeParse((await params).venueId)
  if (!parsedId.success) return new Response('Not found', { status: 404 })
  const query = new URL(request.url).searchParams
  const kind = query.get('kind')
  const from = query.get('from') ?? ''
  const to = query.get('to') ?? ''
  if ((kind !== 'sent' && kind !== 'log') || !DAY.test(from) || !DAY.test(to)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const venue = await getVenue(organization.id, parsedId.data)
    if (!venue) return new Response('Not found', { status: 404 })
    const actor = { kind: 'user' as const, userId: access.user.id, sessionId: access.sessionId }
    const read = await readExportDays(getPool(), {
      tenantId: organization.id,
      venueId: venue.id,
      actor,
      from,
      to,
    })
    if (!read.ok) {
      return new Response(read.code === 'invalid_range' ? 'Not found' : 'Forbidden', {
        status: read.code === 'invalid_range' ? 404 : 403,
      })
    }
    const t = await getTranslations('tonight')
    const say = (key: string, values?: Record<string, string | number>) =>
      t(key as never, values as never)
    const locale = (await getLocale()) === 'en' ? 'en' : 'bg'
    const scope: NightScope = {
      tenantId: organization.id,
      venue,
      actor,
      sourceNone: t('source_none'),
    }
    const currency = (CURRENCIES as readonly string[]).includes(read.access.venue.currency)
      ? (read.access.venue.currency as Currency)
      : 'EUR'

    let source = scope.sourceNone
    let rows: ReturnType<typeof sentExportRows>
    if (kind === 'sent') {
      const days = []
      for (const day of read.sentDays) {
        const loaded = await loadSentOrders(scope, { day, limit: 2000 })
        if (!loaded.ok) return new Response('Forbidden', { status: 403 })
        source = loaded.frame.source
        days.push({ day, rows: loaded.list.rows })
      }
      rows = sentExportRows(days, { say, source })
    } else {
      const days = []
      for (const day of read.logDays) {
        const loaded = await loadLog(scope, { locale, day, limit: 2000 })
        if (!loaded.ok) return new Response('Forbidden', { status: 403 })
        source = loaded.frame.source
        days.push({ day, rows: loaded.log.rows })
      }
      rows = logExportRows(days, {
        say,
        source,
        currency,
        locale: toDataLocale(locale),
      })
    }
    return new Response(nightCsv(rows, currency), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName(venue.slug, kind, from, to)}"`,
        // Money and who did what: private to the venue's staff.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('tonight_export_csv_failed', error)
    return new Response('Could not make the file', { status: 500 })
  }
}
