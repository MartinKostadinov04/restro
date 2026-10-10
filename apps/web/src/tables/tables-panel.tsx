'use client'

// The Tables & QR tab (brief S3-07, D61): the venue's barsy tables by hall, each with its code,
// and the card that says which address the codes carry. Owners and admins create, change and turn
// off codes; everyone else reads and prints. The data comes from the server component
// (tables-tab.tsx); every change is a server action that refreshes it.
import { PrinterIcon, QrCodeIcon, TableIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { createAllCodesAction } from '@/server/tables/actions'
import type { TablesView } from '@/server/tables/view'

import { QrAddressCard } from './qr-address-card'
import { TableRow } from './table-row'
import { useFailureText } from './use-failure-text'

export function TablesPanel({ view }: { view: TablesView }) {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const [pending, startTransition] = useTransition()

  if (view.total === 0) {
    return (
      <Empty className="min-h-72" data-testid="tables-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TableIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={`/venues/${view.venueId}?tab=integration`}>{t('empty.action')}</Link>
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

  return (
    <div className="space-y-8" data-testid="tables-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-medium">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
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
          {view.canManage ? (
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

      <div className="space-y-6">
        {view.halls.map((hall) => (
          <section
            key={hall.name ?? '__none'}
            className="space-y-2"
            data-testid="hall"
            aria-label={hall.name ?? t('halls.none')}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold" data-testid="hall-name">
                {hall.name ?? t('halls.none')}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t('halls.count', { count: hall.tables.length })}
              </span>
            </div>
            <Card className="py-0">
              <CardContent className="px-4">
                <ul className="divide-y">
                  {hall.tables.map((row) => (
                    <TableRow key={row.id} row={row} canManage={view.canManage} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}
      </div>
    </div>
  )
}
