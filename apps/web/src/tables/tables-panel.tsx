'use client'

// The Tables & QR tab (briefs S3-07, S5; D94, D95): the venue's areas as sections, each with its
// tables as a grid of cards, the menu each area and table shows, and the card that says where the
// codes lead. Owners and admins create, change and turn off codes and edit areas, tables and
// menus; everyone else reads and prints. On a venue with a till the areas and tables are the
// till's (renamed, reordered and hidden here); on a venue made by hand the owner makes them. The
// data comes from the server component (tables-tab.tsx); every change is a server action that
// refreshes it. The codes themselves come from the worker once the page is up (use-revealed-codes).
// Where a connector takes payments, a banner at the top names the bars that still have no payment
// table; it stays while that holds (#215).
import { LandmarkIcon, PrinterIcon, QrCodeIcon, TableIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { TillLabelProvider } from '@/fields/till-label'
import { createAllCodesAction } from '@/server/tables/actions'
import { type TablesView, withRevealed } from '@/server/tables/view'

import { AddAreaForm } from './add-area-form'
import { AreaSection } from './area-section'
import { QrAddressCard } from './qr-address-card'
import { useFailureText } from './use-failure-text'
import { useRevealedCodes } from './use-revealed-codes'

export function TablesPanel({ view }: { view: TablesView }) {
  return (
    <TillLabelProvider label={view.sourceLabel}>
      <Panel view={view} />
    </TillLabelProvider>
  )
}

/** How many bars the banner names before "and {count} more". */
const BANNER_BARS = 3

/** The bars that still have no payment table, until none is left (not dismissible). */
function PaymentTablesBanner({
  missing,
}: {
  missing: readonly { readonly name: string | null }[]
}) {
  const t = useTranslations('ownerSettings')
  if (missing.length === 0) return null
  const names = missing.map((queue) => queue.name ?? t('pt_no_bar_group'))
  const bars =
    names.length <= BANNER_BARS
      ? names.join(', ')
      : t('pt_banner_list', {
          first: names.slice(0, BANNER_BARS).join(', '),
          count: names.length - BANNER_BARS,
        })
  return (
    <Alert
      role="status"
      className="border-warning/40 [&>svg]:text-warning"
      data-testid="payment-tables-banner"
    >
      <LandmarkIcon aria-hidden />
      <AlertDescription className="break-words text-foreground">
        {t('pt_banner', { bars })}
      </AlertDescription>
    </Alert>
  )
}

function Panel({ view: given }: { view: TablesView }) {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const [pending, startTransition] = useTransition()
  const view = withRevealed(given, useRevealedCodes(given))

  if (view.fromTill && view.total === 0) {
    return (
      <Empty className="min-h-72" data-testid="tables-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TableIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.description', { source: view.sourceLabel })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={`/venues/${view.venueId}?tab=settings#menu-source`}>
              {t('empty.action')}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  function createAll() {
    startTransition(async () => {
      const result = await createAllCodesAction({ venueId: view.venueId })
      if (!result.ok) {
        toast.error(failureText(result))
        return
      }
      if ((result.issued ?? 0) > 0) toast.success(t('created', { count: result.issued ?? 0 }))
      else toast.message(t('createdNone'))
      if ((result.skippedNoLabel ?? 0) > 0) {
        toast.warning(t('skipped', { count: result.skippedNoLabel ?? 0 }))
      }
      if (!result.queued) toast.warning(t('queuedLate'))
    })
  }

  const areas = view.halls.map((hall) => ({
    id: hall.id,
    name: hall.name,
    tableCount: hall.tables.length,
  }))
  const live = view.menus.find((menu) => menu.live)
  const canAddAreas = view.canManage && !view.fromTill

  const payment =
    view.paying === null ? null : { canMark: view.paying.canMark, email: view.paying.email }

  return (
    <div className="space-y-8" data-testid="tables-tab">
      {view.paying === null ? null : <PaymentTablesBanner missing={view.paying.missing} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-medium">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="tables-source-note">
            {view.fromTill ? t('introTill', { source: view.sourceLabel }) : t('introHand')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground" data-testid="venue-menu">
            {live === undefined ? t('venueMenuNone') : t('venueMenu', { menu: live.name })}
          </p>
          <p className="mt-2 text-sm font-medium" data-testid="tables-summary">
            {t('summary', { total: view.total, coded: view.coded })}
          </p>
          {view.canManage ? null : (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="tables-read-only">
              {t('readOnly')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.canManage && view.total > 0 ? (
            <Button type="button" disabled={pending} onClick={createAll} data-testid="create-all">
              <QrCodeIcon aria-hidden />
              {pending ? t('createAllWorking') : t('createAll')}
            </Button>
          ) : null}
          {view.coded > 0 ? (
            <Button asChild variant="outline">
              <a
                href={`/venues/${view.venueId}/tables/print`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="print-sheet-link"
              >
                <PrinterIcon aria-hidden />
                {t('printSheet')}
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled
              title={t('printNone')}
              data-testid="print-sheet-link"
            >
              <PrinterIcon aria-hidden />
              {t('printSheet')}
            </Button>
          )}
        </div>
      </div>

      <QrAddressCard view={view} />

      {view.halls.length === 0 ? (
        <div className="space-y-1" data-testid="areas-empty">
          <p className="font-medium">{t('emptyHand.title')}</p>
          <p className="text-sm text-muted-foreground">{t('emptyHand.description')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {view.halls.map((hall, index) => (
            <AreaSection
              key={hall.id}
              hall={hall}
              index={index}
              count={view.halls.length}
              venueId={view.venueId}
              canManage={view.canManage}
              fromTill={view.fromTill}
              menus={view.menus}
              areas={areas}
              payment={payment}
            />
          ))}
        </div>
      )}

      {canAddAreas ? <AddAreaForm venueId={view.venueId} /> : null}
    </div>
  )
}
