'use client'

// The Tables & QR tab (briefs S3-07, S5; D94, D95): the venue's areas as sections, each with its
// tables as a grid of cards, the menu each area and table shows, and the card that says where the
// codes lead. An index of the areas at the top jumps to each (screen round 11-18, S14). Owners and
// admins see, create, change, turn off and print codes and edit areas, tables and menus; everyone
// else reads the tables and menus, without codes (S25). On a venue with a till the areas and tables are the
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
import { useSignInAgain } from '@/settings/use-settings-run'

import { AddAreaForm } from './add-area-form'
import { AreaSection, areaAnchor } from './area-section'
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

/**
 * The tables "Create the missing codes" would give a code: shown, in a shown area, not a payment
 * table, and without one yet (as core's `issueAllTableTokens` picks them).
 */
export function missingCodes(view: TablesView): number {
  return view.halls
    .filter((hall) => hall.isPublic)
    .flatMap((hall) => hall.tables)
    .filter((row) => row.isPublic && !row.isPaymentTable && !row.hasCode).length
}

/**
 * The areas as jump links at the top, each with its table count (S14): one tap to an area. The
 * count is what the summary counts (no payment table), so the areas add up to it; the link's name
 * reads "Terrace, 5 tables", not the two spans run together. An area with no table guests sit
 * at (one that holds only payment tables, or none yet) is left out: its section stays below. With
 * fewer than two areas to jump to there is no index.
 */
function AreaIndex({ halls }: { halls: TablesView['halls'] }) {
  const t = useTranslations('tables')
  const entries = halls
    .map((hall) => ({ hall, count: hall.tables.filter((row) => !row.isPaymentTable).length }))
    .filter((entry) => entry.count > 0)
  if (entries.length < 2) return null
  return (
    <nav aria-label={t('index.label')} data-testid="area-index">
      <ul className="flex flex-wrap gap-2">
        {entries.map(({ hall, count }) => {
          return (
            <li key={hall.id} className="min-w-0 max-w-full">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal phone:h-auto phone:min-h-11"
              >
                <a
                  href={`#${areaAnchor(hall.id)}`}
                  aria-label={t('index.jump', { name: hall.name, count })}
                  data-testid="area-jump"
                >
                  <span className="[overflow-wrap:anywhere]">{hall.name}</span>
                  <span className="text-muted-foreground">{count}</span>
                </a>
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Panel({ view: given }: { view: TablesView }) {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const [pending, startTransition] = useTransition()
  const again = useSignInAgain()
  const { revealed, failed, retry } = useRevealedCodes(given)
  const view = withRevealed(given, revealed)
  // A wait that ends without a single code says so (#441); once one code is drawn, there is none.
  const codesUnavailable = failed && view.coded > 0 && view.sample === null

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
            <Link href={`/venues/${view.venueId}?tab=settings&section=general#menu-source`}>
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
        if (result.error === 'sign_in_again') {
          again.ask(createAll)
          return
        }
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
  // Codes are drawn only for owners and admins (#70): everyone else gets no code, no print sheet
  // and no address card, and one line that says so (S25).
  const seesCodes = view.canManage
  const missing = missingCodes(view)
  // One primary action: the missing codes while there are any, else the print sheet (R1).
  const printPrimary = seesCodes && missing === 0

  const payment =
    view.paying === null ? null : { canMark: view.paying.canMark, email: view.paying.email }

  return (
    <div className="space-y-8" data-testid="tables-tab">
      {again.dialog}
      {view.paying === null ? null : <PaymentTablesBanner missing={view.paying.missing} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-medium">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
          {live === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="venue-menu">
              {t('venueMenuNone')}
            </p>
          ) : null}
          <p className="mt-2 text-sm font-medium" data-testid="tables-summary">
            {t('summary', { total: view.guestTotal, coded: view.coded })}
          </p>
          {seesCodes ? null : (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="tables-read-only">
              <span data-testid="tables-codes-hidden">{t('codesOwnersOnly')}</span> {t('readOnly')}
            </p>
          )}
        </div>
        {seesCodes && (missing > 0 || view.coded > 0) ? (
          <div className="flex flex-wrap items-center gap-2">
            {missing > 0 ? (
              <Button type="button" disabled={pending} onClick={createAll} data-testid="create-all">
                <QrCodeIcon aria-hidden />
                {pending ? t('createAllWorking') : t('createMissing', { count: missing })}
              </Button>
            ) : null}
            {/* No sheet to print before a code exists, so no button either (R2). */}
            {view.coded > 0 ? (
              <Button asChild variant={printPrimary ? 'default' : 'outline'}>
                <a
                  href={`/venues/${view.venueId}/tables/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="print-sheet-link"
                  data-primary={printPrimary}
                >
                  <PrinterIcon aria-hidden />
                  {t('printSheet')}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {seesCodes ? (
        <QrAddressCard view={view} codesUnavailable={codesUnavailable} onRetry={retry} />
      ) : null}

      <AreaIndex halls={view.halls} />

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
              payFirst={view.payFirst}
            />
          ))}
        </div>
      )}

      {canAddAreas ? <AddAreaForm venueId={view.venueId} /> : null}
    </div>
  )
}
