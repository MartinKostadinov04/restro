'use client'

// "End the night" (#332; D138, RS-48): an admin ends the night before the club's closing hour. The
// dialog names the action and its consequence ("Remove a thing for good" in its structure), with
// the preview's numbers in its body as short lines, in the end-of-night report's own words (S13,
// copy rule 8): how many tables close for phones, how many bills stay open in the POS, how many
// parties become Finished, No-shows and Not seated, how many online requests nobody answered are
// declined (#578; each guest gets an email), a line only where there is one, and the
// club's closing hour when it has not come yet. While the preview is counted the dialog shows its pending state; a preview that
// cannot be read, or a write that fails, is the error toast that stays, and nothing is closed.
// Closing the night never moves money: a table paying by card keeps its code until the payment
// ends. There is no Undo — a whole night is never put back; one reservation is, on its own sheet.
import { Loader2Icon, LockIcon, TriangleAlertIcon } from 'lucide-react'
import { unstable_rethrow } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WRAPS } from '@/lib/wrapping'
import {
  endNightAction,
  type NightEndPreviewView,
  nightEndPreviewAction,
} from '@/server/tonight/actions'
import type { TonightView } from '@/server/tonight/view'

import { useFailureText } from './failure'
import { useTonightRun } from './run'
import { CLOSE_44 } from './tab-parts'

const TOAST_ID = 'night-end'

/**
 * The closed night's banner on Tonight ("A state of the whole page"). While the bills it left open
 * have their row ("3 bills are still open. The night ended at…"), that row is the one notice (S13).
 */
export function NightEndedBanner({ view }: { view: Pick<TonightView, 'nightEnd' | 'rows'> }) {
  const t = useTranslations('tonight')
  if (view.nightEnd === null || view.rows.some((row) => row.kind === 'night_end')) return null
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border bg-info/10 p-4"
      data-testid="night-ended"
    >
      <LockIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">{t('ne_closed')}</p>
    </div>
  )
}

/** One line of the consequence: what it counts, for the screen and for the PIN sheet's words. */
interface Line {
  readonly id: 'codes' | 'bills' | 'finished' | 'noshows' | 'notseated' | 'declined'
  readonly text: string
}

/**
 * The consequence, in the preview's numbers: one short line per count that is not zero, the
 * reservation statuses in the report's words ("No-shows: 2").
 */
export function consequenceLines(
  t: (key: string, values?: Record<string, string | number>) => string,
  preview: NightEndPreviewView,
  source: string,
): readonly Line[] {
  const count = (label: string, n: number) => t('ne_l_count', { label, n })
  const lines: Line[] = []
  if (preview.codesClose > 0)
    lines.push({ id: 'codes', text: t('ne_l_codes', { k: preview.codesClose }) })
  if (preview.openBills > 0) {
    lines.push({ id: 'bills', text: t('ne_l_bills', { n: preview.openBills, source }) })
  }
  if (preview.finished > 0) {
    lines.push({ id: 'finished', text: count(t('ne_l_finished'), preview.finished) })
  }
  if (preview.noShow > 0) {
    lines.push({ id: 'noshows', text: count(t('nt_r_noshows'), preview.noShow) })
  }
  if (preview.notSeated > 0) {
    lines.push({ id: 'notseated', text: count(t('nt_r_notseated'), preview.notSeated) })
  }
  if (preview.declined > 0) {
    lines.push({ id: 'declined', text: t('ne_l_declined', { n: preview.declined }) })
  }
  return lines
}

/**
 * The confirm dialog with its preview. Opened from Tonight's tables menu; on a shared device the
 * confirm sends the person to a manager's PIN sheet, which names who ended it (D141).
 */
export function NightEndDialog({
  view,
  open,
  onClose,
}: {
  /** Tonight's view, or the End of night tab's frame: the venue, the device and the POS' name. */
  view: Pick<TonightView, 'venueId' | 'device' | 'source'>
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('tonight')
  const say = (key: string, values?: Record<string, string | number>) =>
    t(key as never, values as never)
  const source = view.source === '' ? t('source_none') : view.source
  const failureText = useFailureText()
  const { run, busy } = useTonightRun()
  const [preview, setPreview] = useState<NightEndPreviewView | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setPreview(null)
    const fail = (error: string) => {
      if (!live) return
      onClose()
      toast.error(failureText(error), {
        id: TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      })
    }
    nightEndPreviewAction({ venueId: view.venueId })
      .then((result) => {
        if (!result.ok) fail(result.error)
        else if (live) setPreview(result.preview)
      })
      .catch((error: unknown) => {
        unstable_rethrow(error)
        fail('failed')
      })
    return () => {
      live = false
    }
  }, [open, view.venueId, failureText, onClose])

  const lines = preview === null ? null : consequenceLines(say, preview, source)
  // The PIN sheet repeats the consequence in one paragraph, for a manager who walks over.
  const body =
    lines === null ? null : [t('ne_after'), ...lines.map((line) => line.text)].join(' · ')

  function confirm() {
    if (preview === null || body === null) return
    onClose()
    run({
      id: TOAST_ID,
      ...(view.device ? { pin: { level: 'manager' as const, title: t('ne_t'), body } } : {}),
      act: (pin) => endNightAction({ venueId: view.venueId, pin }),
      done: t('ne_toast'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="night-end-dialog"
        aria-busy={preview === null}
        className={CLOSE_44}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t('ne_t')}</DialogTitle>
          <DialogDescription data-testid="night-end-preview">
            {preview === null ? (
              <span className="inline-flex items-center gap-2">
                <Loader2Icon
                  aria-hidden
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {t('ne_loading')}
              </span>
            ) : preview.ended ? (
              t('ne_closed')
            ) : (
              t('ne_after')
            )}
          </DialogDescription>
        </DialogHeader>
        {preview === null || preview.ended || lines === null ? null : (
          <div className="space-y-2 text-sm">
            {lines.length === 0 ? null : (
              <ul className="space-y-1 text-base" data-testid="night-end-lines">
                {lines.map((line) => (
                  <li
                    key={line.id}
                    data-testid={line.id === 'bills' ? 'night-end-bills' : `night-end-${line.id}`}
                    className={line.id === 'bills' ? 'font-medium' : undefined}
                  >
                    {line.text}
                  </li>
                ))}
              </ul>
            )}
            {preview.early === null ? null : (
              <p
                className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-foreground"
                data-testid="night-end-early"
              >
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('ne_close', { time: preview.early.closes, now: preview.early.now })}
              </p>
            )}
            {preview.codesKept === 0 ? null : (
              <p className="text-muted-foreground" data-testid="night-end-card">
                {t('ne_card')}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" className={`h-11 ${WRAPS}`} onClick={onClose}>
            {t('ne_keep')}
          </Button>
          {preview?.ended === true ? null : (
            <Button
              type="button"
              variant="destructive"
              className={`h-11 ${WRAPS}`}
              disabled={preview === null || busy}
              data-testid="night-end-confirm"
              onClick={confirm}
            >
              {preview?.early == null ? t('ne_open') : t('ne_early')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
