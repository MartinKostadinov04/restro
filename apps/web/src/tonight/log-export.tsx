'use client'

// "Export" in Tonight › Log (#87; plan `2026-10-27-settings-alerts-export-plan.md` §B), drawn only for
// a role holding `log.view` and `night.view_full`. A dialog with From and To (the last 7 nights to
// start with) and two downloads, each one CSV in the end-of-night CSV's format: the sent orders and
// the Log. A range wider than what the venue still holds downloads what is held. The files come
// from `/api/venues/<id>/export`, which checks the right again.
import { DownloadIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** How many nights the dialog starts with, today included. */
const DEFAULT_NIGHTS = 7

/** `day` moved back by `back` days. */
function shift(day: string, back: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - back)
  return date.toISOString().slice(0, 10)
}

export function LogExport({ venueId, today }: { venueId: string; today: string }) {
  const t = useTranslations('tonight')
  const [from, setFrom] = useState(() => shift(today, DEFAULT_NIGHTS - 1))
  const [to, setTo] = useState(today)
  const valid = from !== '' && to !== '' && from <= to
  const href = (kind: 'sent' | 'log') =>
    `/api/venues/${venueId}/export?kind=${kind}&from=${from}&to=${to}`

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11" data-testid="log-export">
          <DownloadIcon aria-hidden />
          {t('lg_export')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('lg_export')}</DialogTitle>
          <DialogDescription>{t('lg_export_kept')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="export-from">{t('lg_from')}</Label>
            <Input
              id="export-from"
              type="date"
              value={from}
              max={today}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="export-to">{t('lg_to')}</Label>
            <Input
              id="export-to"
              type="date"
              value={to}
              max={today}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {valid ? null : (
          <p className="text-sm text-destructive" role="alert">
            {t('lg_export_range')}
          </p>
        )}
        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          {valid ? (
            <>
              <Button asChild className="h-11">
                <a href={href('sent')} download data-testid="export-sent">
                  <DownloadIcon aria-hidden />
                  {t('lg_dl_sent')}
                </a>
              </Button>
              <Button asChild variant="outline" className="h-11">
                <a href={href('log')} download data-testid="export-log">
                  <DownloadIcon aria-hidden />
                  {t('lg_dl_log')}
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button disabled className="h-11">
                {t('lg_dl_sent')}
              </Button>
              <Button variant="outline" disabled className="h-11">
                {t('lg_dl_log')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
