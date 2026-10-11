// /venues/<id>/tables/print: the print sheet of a venue's table codes (brief S3-07). A page of its
// own, outside the admin frame (no sidebar), so what the browser prints is only the cards. It is
// behind the sign-in like the rest of the admin: the proxy sends a visitor without a session to
// /login, and this page checks the session and the venue itself. Read-only: any member of the
// organisation may print.
import { ArrowLeftIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getAssetStore } from '@/server/assets'
import { getPool } from '@/server/db'
import { loadVenueLogo } from '@/server/design/service'
import { defaultQrBaseUrl } from '@/server/env'
import { canManageIntegration } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { loadTablesView } from '@/server/tables/service'
import { getVenue } from '@/server/venues'
import { PrintButton } from '@/tables/print-button'
import { CARDS_PER_SHEET, chunkCards, PRINT_CSS, PrintSheets } from '@/tables/print-sheet'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function PrintTablesPage({
  params,
}: PageProps<'/venues/[venueId]/tables/print'>) {
  const { organization } = await requireTenant()
  // Another tenant's venue and a made-up id both come back as null (row-level security).
  const venue = await getVenue(organization.id, (await params).venueId)
  if (!venue) notFound()

  const t = await getTranslations('tables')
  const view = await loadTablesView(
    {
      pool: getPool(),
      tenantId: organization.id,
      venue,
      canManage: canManageIntegration(organization.role),
    },
    defaultQrBaseUrl(),
  )
  const logo = await loadVenueLogo(getPool(), organization.id, venue, getAssetStore)

  const cards = view.halls
    .flatMap((hall) => hall.tables)
    .flatMap((row) =>
      row.qrSvg !== null && row.address !== null && row.shownAs !== null
        ? [{ id: row.id, label: row.shownAs, address: row.address, qrSvg: row.qrSvg }]
        : [],
    )

  return (
    <div className="pc-root" data-testid="print-page">
      <style>{PRINT_CSS}</style>
      <header className="pc-toolbar">
        <div style={{ maxWidth: '110mm' }}>
          <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
            {t('print.title', { venue: venue.name })}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#52525b' }}>
            {t('print.intro')}
          </p>
          {cards.length > 0 ? (
            <p
              style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#52525b' }}
              data-testid="print-pages"
            >
              {t('print.pages', {
                cards: cards.length,
                pages: chunkCards(cards, CARDS_PER_SHEET).length,
              })}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link
            href={`/venues/${venue.id}?tab=tables`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.875rem',
            }}
          >
            <ArrowLeftIcon size={16} aria-hidden />
            {t('print.back')}
          </Link>
          {cards.length > 0 ? <PrintButton /> : null}
        </div>
      </header>
      {cards.length > 0 ? (
        <PrintSheets venueName={venue.name} logoUrl={logo?.url ?? null} cards={cards} />
      ) : (
        <p style={{ padding: '16px', textAlign: 'center' }} data-testid="print-empty">
          {t('print.empty')}
        </p>
      )}
    </div>
  )
}
