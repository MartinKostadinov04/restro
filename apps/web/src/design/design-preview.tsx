'use client'

// The live phone preview of the Design tab (brief SH-05a): the same phone frame and the same face
// as the publish preview, drawn from the draft snapshot with the form's UNSAVED look laid over it
// (`previewSnapshot`), so it always shows the current form. The draft is asked for once when the
// tab opens, and again when "Refresh" is pressed (the menu may have changed in the composer). A
// venue with no menu, or nothing visible, gets the publish preview's own message.
import type { LiveOverlay, MenuSnapshot, VenueTheme } from '@restro/core'
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DraftFace, type PreviewScheme } from '@/publish/draft-face'
import { PhoneFrame } from '@/publish/phone-frame'
import { previewDraftAction } from '@/server/publish/actions'

import { previewSnapshot } from './preview-snapshot'
import type { OptionValues } from './template-options'

type Draft =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly snapshot: MenuSnapshot; readonly overlay: LiveOverlay }
  | {
      readonly state: 'error'
      readonly error: 'no_menu' | 'nothing_visible' | 'blocked' | 'failed'
    }

export function DesignPreview({
  venueId,
  theme,
  face,
  options,
  scheme,
  onScheme,
}: {
  venueId: string
  /** The form's look, whole. */
  theme: VenueTheme
  /** The chosen template, and its options as the preview should draw them. */
  face: string
  options: OptionValues
  scheme: PreviewScheme
  onScheme: (scheme: PreviewScheme) => void
}) {
  const t = useTranslations('design.preview')
  const tPublish = useTranslations('publish.previewDialog')
  const [draft, setDraft] = useState<Draft>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // Dragging a slider or typing a colour must stay smooth: the face is redrawn a moment later.
  const lookNow = useDeferredValue({ theme, face, options })

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only restarts the load
  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    previewDraftAction(venueId).then(
      (result) => {
        if (cancelled) return
        setRefreshing(false)
        setDraft(
          result.ok
            ? { state: 'ready', snapshot: result.snapshot, overlay: result.overlay }
            : { state: 'error', error: result.error },
        )
      },
      () => {
        if (cancelled) return
        setRefreshing(false)
        setDraft({ state: 'error', error: 'failed' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [venueId, attempt])

  const snapshot = useMemo(
    () => (draft.state === 'ready' ? previewSnapshot(draft.snapshot, lookNow) : null),
    [draft, lookNow],
  )

  return (
    <div className="grid gap-3" data-testid="design-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => setAttempt((n) => n + 1)}
        >
          <RefreshCwIcon aria-hidden className={refreshing ? 'animate-spin' : undefined} />
          {t('refresh')}
        </Button>
      </div>

      {draft.state === 'ready' && snapshot !== null ? (
        <>
          <fieldset
            className="m-0 flex items-center justify-center gap-2 border-0 p-0"
            aria-label={tPublish('scheme')}
          >
            {(['light', 'dark'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={scheme === value ? 'default' : 'outline'}
                aria-pressed={scheme === value}
                onClick={() => onScheme(value)}
              >
                {tPublish(value)}
              </Button>
            ))}
          </fieldset>
          <PhoneFrame label={tPublish('frame')}>
            <DraftFace
              snapshot={snapshot}
              overlay={draft.overlay}
              scheme={scheme}
              faceId={lookNow.face}
            />
          </PhoneFrame>
        </>
      ) : draft.state === 'loading' ? (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {tPublish('loading')}
        </p>
      ) : draft.state === 'error' ? (
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <p role="alert" className="text-sm" data-testid="design-preview-error">
            {tPublish(draft.error)}
          </p>
          {draft.error === 'failed' ? (
            <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {tPublish('retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
