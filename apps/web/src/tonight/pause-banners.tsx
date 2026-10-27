'use client'

// The state of the whole page (Patterns: "A state of the whole page", plan §3, §12 B): one banner
// per active pause, stacked at the top and not dismissible. Restro's own pause has no button
// (nobody at the venue can lift it, D122 §6); a staff pause has "Resume ordering": a manager's
// PIN on the shared tablet, one tap for a manager on their own session, no button for anyone else.
import { CirclePauseIcon, OctagonAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { liftOrderingAction, pauseOrderingAction } from '@/server/tonight/actions'
import type { PauseBanner, TonightView } from '@/server/tonight/view'

import { useTonightRun } from './run'

function StaffBanner({ banner, view }: { banner: PauseBanner; view: TonightView }) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  const scope = banner.barName ?? t('p_all')
  // On a shared device the manager's PIN decides; on a personal session the role does.
  const mayLift = view.device || view.can.lift
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border bg-info/10 p-4 sm:flex-row sm:items-center"
      data-testid="pause-banner"
      data-kind="staff"
    >
      <CirclePauseIcon aria-hidden className="size-5 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">
        {t('b_staff', { scope, who: banner.who ?? t('who_t'), time: banner.at })}
      </p>
      {mayLift ? (
        <Button
          type="button"
          variant="outline"
          className="h-12 whitespace-normal"
          disabled={busy}
          onClick={() =>
            run({
              id: `lift:${banner.id}`,
              ...(view.device
                ? { pin: { level: 'manager' as const, title: t('lift'), body: t('lift_b') } }
                : {}),
              act: (pin) => liftOrderingAction({ venueId: view.venueId, pauseId: banner.id, pin }),
              done: t('lift_toast'),
              // Undo pauses the same scope again (it only makes the menu more cautious).
              undo: () => pauseOrderingAction({ venueId: view.venueId, barId: banner.barId }),
            })
          }
        >
          {t('lift')}
        </Button>
      ) : null}
    </div>
  )
}

/** The banners at the top of Tonight. */
export function PauseBanners({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  if (view.banners.length === 0) return null
  return (
    <div className="space-y-2" data-testid="pause-banners">
      {view.banners.map((banner) =>
        banner.kind === 'restro' ? (
          <div
            key={banner.id}
            role="status"
            className="flex items-start gap-3 rounded-lg border bg-info/10 p-4"
            data-testid="pause-banner"
            data-kind="restro"
          >
            <OctagonAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
            <p className="min-w-0 text-base [overflow-wrap:anywhere]">
              {t('b_restro', { source: view.source })}
            </p>
          </div>
        ) : (
          <StaffBanner key={banner.id} banner={banner} view={view} />
        ),
      )}
    </div>
  )
}
