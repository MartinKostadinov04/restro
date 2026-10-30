'use client'

// The live phone preview of the Design tab (briefs SH-05a and S7): the same phone frame and the same
// face as the publish preview, drawn from the draft snapshot of the OPEN menu with the form's
// UNSAVED look laid over it (`previewSnapshot`), so it always shows the current form. The draft
// comes from `usePreviewDraft` (asked for when the tab opens and on "Refresh"). A venue with no
// menu, or nothing visible, gets the publish preview's own message.
//
// The tab keeps it beside the form (sticky) on wide screens and below it at phone width.
//
// "Preview guest services" (D71) draws the service screens the venue switched on with demo data
// (`DraftFace`'s `servicesPreview`), so the owner sees them before the platform supports them. It
// is off when the tab opens.
import {
  DEFAULT_GUEST_FEATURES,
  type GuestFeatures,
  type MenuSnapshot,
  type VenueTheme,
} from '@restro/core'
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DraftFace, type PreviewScheme } from '@/publish/draft-face'
import { PhoneFrame } from '@/publish/phone-frame'

import type { Draft } from './preview-draft'
import { previewSnapshot } from './preview-snapshot'

/** The two buttons that light or darken the phone in the preview. */
export function SchemeSwitch({
  scheme,
  onScheme,
}: {
  scheme: PreviewScheme
  onScheme: (scheme: PreviewScheme) => void
}) {
  const t = useTranslations('publish.previewDialog')
  return (
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
          onClick={() => onScheme(value)}
        >
          {t(value)}
        </Button>
      ))}
    </fieldset>
  )
}

/** What stands in the phone's place while the draft is loading or cannot be shown. */
export function DraftMessage({
  draft,
  onRetry,
  testId,
}: {
  draft: Exclude<Draft, { state: 'ready' }>
  onRetry: () => void
  testId?: string
}) {
  const t = useTranslations('publish.previewDialog')
  if (draft.state === 'loading') {
    return (
      <p role="status" className="py-12 text-center text-sm text-muted-foreground">
        {t('loading')}
      </p>
    )
  }
  return (
    <div className="grid justify-items-center gap-3 py-8 text-center">
      <p role="alert" className="text-sm" data-testid={testId}>
        {t(draft.error)}
      </p>
      {draft.error === 'failed' ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The draft with the form's unsaved look laid over it; null while the draft is not ready, or when
 * there is no look to draw (a closed pop-up).
 */
export function usePreviewLook(draft: Draft, theme: VenueTheme | null): MenuSnapshot | null {
  return useMemo(
    () =>
      draft.state === 'ready' && theme !== null ? previewSnapshot(draft.snapshot, theme) : null,
    [draft, theme],
  )
}

export function DesignPreview({
  draft,
  refreshing,
  onRefresh,
  menuName,
  theme,
  scheme,
  onScheme,
}: {
  draft: Draft
  refreshing: boolean
  onRefresh: () => void
  /** The open menu's name, or null when the venue has none. */
  menuName: string | null
  /** The form's look, whole. */
  theme: VenueTheme
  scheme: PreviewScheme
  onScheme: (scheme: PreviewScheme) => void
}) {
  const t = useTranslations('design.preview')
  const tPublish = useTranslations('publish.previewDialog')
  const [services, setServices] = useState(false)
  const servicesId = useId()

  // Dragging a slider or typing a colour must stay smooth: the face is redrawn a moment later.
  const lookNow = useDeferredValue(theme)
  const snapshot = usePreviewLook(draft, lookNow)

  return (
    <div className="grid gap-3" data-testid="design-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
          {menuName === null ? null : (
            <p className="truncate text-xs text-muted-foreground" data-testid="design-preview-menu">
              {t('menu', { name: menuName })}
            </p>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
          <RefreshCwIcon aria-hidden className={refreshing ? 'animate-spin' : undefined} />
          {t('refresh')}
        </Button>
      </div>

      {draft.state === 'ready' && snapshot !== null ? (
        <>
          <SchemeSwitch scheme={scheme} onScheme={onScheme} />
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={servicesId}>{t('services')}</Label>
              <Switch
                id={servicesId}
                checked={services}
                onCheckedChange={setServices}
                data-testid="design-preview-services"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {services && !anyServiceOn(snapshot.features)
                ? t('servicesNoneOn')
                : t('servicesHint')}
            </p>
          </div>
          <PhoneFrame label={tPublish('frame')}>
            <DraftFace
              snapshot={snapshot}
              overlay={draft.overlay}
              scheme={scheme}
              servicesPreview={services}
            />
          </PhoneFrame>
        </>
      ) : draft.state !== 'ready' ? (
        <DraftMessage draft={draft} onRetry={onRefresh} testId="design-preview-error" />
      ) : null}
    </div>
  )
}

/** True when the venue switched on at least one service at the table (the draft's switches). */
function anyServiceOn(features: GuestFeatures | undefined): boolean {
  const { call_waiter, bill, ordering, pay } = features ?? DEFAULT_GUEST_FEATURES
  return call_waiter.enabled || bill || ordering || pay
}
