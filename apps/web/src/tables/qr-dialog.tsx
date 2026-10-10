'use client'

// A table's code, large (brief S3-07): to read the address under it, scan it from a screen, or
// download it as a picture.
import { DownloadIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TableRowView } from '@/server/tables/view'

import { QrPicture } from './qr-picture'

export function QrDownloads({ tableId }: { tableId: string }) {
  const t = useTranslations('tables.row')
  return (
    <>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/tables/${tableId}/qr?format=png`} download data-testid="download-png">
          <DownloadIcon aria-hidden />
          {t('downloadPng')}
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/tables/${tableId}/qr?format=svg`} download data-testid="download-svg">
          <DownloadIcon aria-hidden />
          {t('downloadSvg')}
        </a>
      </Button>
    </>
  )
}

export function QrDialog({
  row,
  open,
  onOpenChange,
}: {
  row: TableRowView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('tables')
  const shown = row.shownAs ?? t('row.noNumber')
  if (row.qrSvg === null || row.address === null) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="qr-dialog">
        <DialogHeader>
          <DialogTitle>{t('qrDialog.title', { table: shown })}</DialogTitle>
          <DialogDescription>{t('qrDialog.description')}</DialogDescription>
        </DialogHeader>
        <QrPicture
          svg={row.qrSvg}
          alt={t('row.qrAlt', { table: shown })}
          className="mx-auto aspect-square w-full max-w-72 rounded-md border bg-white"
          testId="qr-dialog-picture"
        />
        <div className="grid gap-1 text-sm">
          <span className="font-medium">{t('qrDialog.address')}</span>
          <code
            className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all"
            data-testid="qr-dialog-address"
          >
            {row.address}
          </code>
        </div>
        <div className="flex flex-wrap gap-2">
          <QrDownloads tableId={row.id} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
