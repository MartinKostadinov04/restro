'use client'

// "Preview": a phone-frame dialog with the guest face drawn from the DRAFT. Opening it asks the
// server for the draft snapshot (built in memory with the publisher's own builder and leak guard,
// never written as files) and hands it to the same shell and face the guest page uses. Anyone in
// the organisation may look: it publishes nothing.
import type { LiveOverlay, MenuSnapshot } from '@restro/core'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { previewDraftAction } from '@/server/publish/actions'
import { DraftFace, type PreviewScheme } from './draft-face'
import { PhoneFrame } from './phone-frame'

type Preview =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly snapshot: MenuSnapshot; readonly overlay: LiveOverlay }
  | {
      readonly state: 'error'
      readonly error: 'no_menu' | 'nothing_visible' | 'blocked' | 'failed'
    }

export function PreviewDialog({
  venueId,
  children,
}: {
  venueId: string
  /** The button that opens it. */
  children: ReactNode
}) {
  const t = useTranslations('publish.previewDialog')
  const [open, setOpen] = useState(false)
  const [scheme, setScheme] = useState<PreviewScheme>('light')
  const [preview, setPreview] = useState<Preview>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // Each time it opens the draft is built again: the menu may have changed since last time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the load
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreview({ state: 'loading' })
    previewDraftAction(venueId).then(
      (result) => {
        if (cancelled) return
        setPreview(
          result.ok
            ? { state: 'ready', snapshot: result.snapshot, overlay: result.overlay }
            : { state: 'error', error: result.error },
        )
      },
      () => {
        if (!cancelled) setPreview({ state: 'error', error: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, venueId, attempt])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="preview-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {preview.state === 'ready' ? (
          <>
            <fieldset
              className="m-0 flex items-center justify-center gap-2 border-0 p-0"
              aria-label={t('scheme')}
            >
              {(['light', 'dark'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={scheme === value ? 'default' : 'outline'}
                  aria-pressed={scheme === value}
                  onClick={() => setScheme(value)}
                >
                  {t(value)}
                </Button>
              ))}
            </fieldset>
            <PhoneFrame label={t('frame')}>
              <DraftFace snapshot={preview.snapshot} overlay={preview.overlay} scheme={scheme} />
            </PhoneFrame>
          </>
        ) : preview.state === 'loading' ? (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <p role="alert" className="text-sm">
              {t(preview.error)}
            </p>
            {preview.error === 'failed' ? (
              <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                {t('retry')}
              </Button>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
