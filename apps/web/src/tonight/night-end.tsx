'use client'

// "End the night" (#332; D138, RS-48): an admin ends the night before the club's closing hour. The
// dialog names the action and its consequence ("Remove a thing for good" in its structure), with
// the preview's numbers in its body: how many parties become Finished, No-show and Not seated, how
// many table codes close, how many bills are still open, and the club's closing hour when it has
// not come yet. While the preview is counted the dialog shows its pending state; a preview that
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

const TOAST_ID = 'night-end'

/** The closed night's banner on Tonight ("A state of the whole page"). */
export function NightEndedBanner({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  if (view.nightEnd === null) return null
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

/** The consequence, in the preview's numbers: one sentence, and the waiting list's when it has any. */
function consequence(
  t: ReturnType<typeof useTranslations<'tonight'>>,
  preview: NightEndPreviewView,
): string {
  const parties = preview.finished + preview.noShow + preview.notSeated
  if (parties === 0) return t('ne_empty', { k: preview.codesClose })
  const main = t('ne_b', { n: preview.finished, m: preview.noShow, k: preview.codesClose })
  return preview.notSeated === 0 ? main : `${main} ${t('ne_waiting', { w: preview.notSeated })}`
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
  view: TonightView
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('tonight')
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

  const body = preview === null ? null : consequence(t, preview)

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
      <DialogContent data-testid="night-end-dialog" aria-busy={preview === null}>
        <DialogHeader>
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
              body
            )}
          </DialogDescription>
        </DialogHeader>
        {preview === null || preview.ended ? null : (
          <div className="space-y-2 text-sm">
            {preview.early === null ? null : (
              <p
                className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-foreground"
                data-testid="night-end-early"
              >
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('ne_close', { time: preview.early.closes, now: preview.early.now })}
              </p>
            )}
            {preview.openBills === 0 ? null : (
              <p className="font-medium" data-testid="night-end-bills">
                {t('ne_bills', { n: preview.openBills })}
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
