'use client'

// The live preview of the Design page (D129): the real renderer, drawn from the draft snapshot of the
// open menu with the UNSAVED design laid over it (`previewSnapshot`), in a frame as wide as the
// switcher says and scaled to fit. The frame is its own document (`scaled-frame.tsx`), so the renderer
// meets the width it would meet on that screen (RR-87).
//
// "Preview guest services" (D71) draws the service screens the venue switched on with demo data, so
// the owner sees them before the platform supports them. It is off when the page opens.
import {
  DEFAULT_GUEST_FEATURES,
  type DesignValues,
  type GuestFeatures,
  type MenuSnapshot,
  type VenueTheme,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { useDeferredValue, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { PreviewScheme } from '@/publish/draft-face'

import type { Draft } from './preview-draft'
import type { FrameContent } from './preview-frames'
import { previewSnapshot } from './preview-snapshot'
import { ScaledFrame } from './scaled-frame'
import { Segmented } from './segmented'

/** The widths the switcher draws at, in CSS pixels. */
const DEVICE_WIDTHS = { phone: 390, tablet: 820, pc: 1280 } as const
type Device = keyof typeof DEVICE_WIDTHS
const DEVICES = Object.keys(DEVICE_WIDTHS) as Device[]

/** The two buttons that light or darken the screen in the preview. */
function SchemeSwitch({
  scheme,
  onScheme,
}: {
  scheme: PreviewScheme
  onScheme: (scheme: PreviewScheme) => void
}) {
  const t = useTranslations('publish.previewDialog')
  return (
    <fieldset className="m-0 flex items-center gap-1 border-0 p-0" aria-label={t('scheme')}>
      {(['light', 'dark'] as const).map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={scheme === value ? 'secondary' : 'ghost'}
          aria-pressed={scheme === value}
          onClick={() => onScheme(value)}
        >
          {t(value)}
        </Button>
      ))}
    </fieldset>
  )
}

/** What stands in the frame's place while the draft cannot be shown. */
function DraftMessage({
  draft,
  onRetry,
}: {
  draft: Extract<Draft, { state: 'error' }>
  onRetry: () => void
}) {
  const t = useTranslations('design.preview')
  const tPublish = useTranslations('publish.previewDialog')
  return (
    <div className="grid justify-items-center gap-3 p-8 text-center">
      <p role="alert" className="text-sm" data-testid="design-preview-error">
        {draft.error === 'failed' ? t('failed') : tPublish(draft.error)}
      </p>
      {draft.error === 'failed' ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          {tPublish('retry')}
        </Button>
      ) : null}
    </div>
  )
}

/** The draft with the unsaved design laid over it; null while the draft is not ready. */
function useDraftSnapshot(
  draft: Draft,
  theme: VenueTheme,
  values: DesignValues,
): MenuSnapshot | null {
  // Typing a colour must stay smooth: the frame is redrawn a moment later.
  const design = useDeferredValue(useMemo(() => ({ theme, values }), [theme, values]))
  return useMemo(
    () =>
      draft.state === 'ready' ? previewSnapshot(draft.snapshot, design.theme, design.values) : null,
    [draft, design],
  )
}

export function DesignPreview({
  venueId,
  draft,
  onRetry,
  theme,
  values,
  scheme,
  onScheme,
}: {
  venueId: string
  draft: Draft
  onRetry: () => void
  /** The draft's look, whole. */
  theme: VenueTheme
  values: DesignValues
  scheme: PreviewScheme
  onScheme: (scheme: PreviewScheme) => void
}) {
  const t = useTranslations('design.preview')
  const [device, setDevice] = useState<Device>('phone')
  const [services, setServices] = useState(false)
  const servicesId = useId()
  const snapshot = useDraftSnapshot(draft, theme, values)

  const content = useMemo<FrameContent | null>(
    () =>
      draft.state === 'ready' && snapshot !== null
        ? { snapshot, overlay: draft.overlay, scheme, services }
        : null,
    [draft, snapshot, scheme, services],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="design-preview">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          label={t('device')}
          value={device}
          options={DEVICES.map((value) => ({ value, label: t(`devices.${value}`) }))}
          onChange={setDevice}
        />
        <SchemeSwitch scheme={scheme} onScheme={onScheme} />
        <div className="flex items-center gap-2">
          <Switch
            id={servicesId}
            checked={services}
            onCheckedChange={setServices}
            data-testid="design-preview-services"
          />
          <Label htmlFor={servicesId} className="font-normal">
            {t('services')}
          </Label>
        </div>
      </div>
      {services && snapshot !== null && !anyServiceOn(snapshot.features) ? (
        <p className="text-xs text-muted-foreground">{t('servicesNoneOn')}</p>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/40"
        data-testid="design-preview-well"
      >
        {draft.state === 'error' ? (
          <DraftMessage draft={draft} onRetry={onRetry} />
        ) : draft.state === 'loading' ? (
          <Skeleton className="size-full rounded-none" role="status" aria-label={t('loading')} />
        ) : (
          <ScaledFrame
            venueId={venueId}
            slot="main"
            width={DEVICE_WIDTHS[device]}
            title={t('title')}
            content={content}
            testId="design-preview-frame"
          />
        )}
      </div>
    </div>
  )
}

/** True when the venue switched on at least one service at the table (the draft's switches). */
function anyServiceOn(features: GuestFeatures | undefined): boolean {
  const { call_waiter, bill, ordering, pay } = features ?? DEFAULT_GUEST_FEATURES
  return call_waiter.enabled || bill || ordering || pay
}
