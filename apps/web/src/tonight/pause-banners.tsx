'use client'

// The state of the whole page (Patterns: "A state of the whole page", plan §3, §12 B): one banner
// per active pause, stacked at the top and not dismissible. Restro's own pause has a button for
// Restro's admin team only (nobody at the venue can lift it, D120, D122 §6); a staff pause has
// "Resume ordering": a manager's PIN on the shared tablet, one tap for a manager on their own
// session, no button for anyone else.
import { CirclePauseIcon, CreditCardIcon, OctagonAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { WRAPS } from '@/lib/wrapping'
import {
  liftOrderingAction,
  liftRestroPauseAction,
  pauseOrderingAction,
} from '@/server/tonight/actions'
import type { PauseBanner, TonightView } from '@/server/tonight/view'

import { useTonightRun, wroteSomething } from './run'

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
          className={WRAPS}
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
              undo: (_, undo) =>
                pauseOrderingAction({ venueId: view.venueId, barId: banner.barId, undo }),
              undoWhen: wroteSomething,
            })
          }
        >
          {t('lift')}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Restro's own pause. Its button lifts it for Restro's admin team, with no Undo: only the worker's
 * breaker starts such a pause, and nothing puts it back as it was.
 */
function RestroBanner({ banner, view }: { banner: PauseBanner; view: TonightView }) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border bg-info/10 p-4 sm:flex-row sm:items-center"
      data-testid="pause-banner"
      data-kind="restro"
    >
      <OctagonAlertIcon aria-hidden className="size-5 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">
        {t('b_restro', { source: view.source })}
      </p>
      {view.operator ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          onClick={() =>
            run({
              id: `lift:${banner.id}`,
              act: () => liftRestroPauseAction({ venueId: view.venueId, pauseId: banner.id }),
              done: t('lift_toast'),
            })
          }
        >
          {t('lift')}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Card payments in the app are stopped (#115; paying plan Q5): shown to every role so a waiter
 * takes the payment at the till, stacked under any ordering pause, not dismissible. "Reconnect"
 * only for the person who may connect payments; anyone else reads who does (`pb_who`).
 */
function PayingBanner({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  const paying = view.paying
  if (paying === null) return null
  const provider = view.provider ?? t('pb_provider_none')
  const words = { source: view.source, provider }
  const text =
    paying.state === 'paused'
      ? t('pb_paused', words)
      : paying.state === 'lost'
        ? t('pb_lost', words)
        : t('pb_restricted', words)
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border bg-info/10 p-4 sm:flex-row sm:items-center"
      data-testid="pause-banner"
      data-kind="paying"
      data-state={paying.state}
    >
      <CreditCardIcon aria-hidden className="size-5 shrink-0 text-info" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-base [overflow-wrap:anywhere]">{text}</p>
        {paying.state !== 'paused' && !paying.canReconnect ? (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{t('pb_who')}</p>
        ) : null}
      </div>
      {paying.state !== 'paused' && paying.canReconnect ? (
        <Button asChild variant="outline" className={WRAPS}>
          <Link href={`/venues/${view.venueId}?tab=settings&section=paying`}>
            {t('pb_reconnect')}
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/** The banners at the top of Tonight. */
export function PauseBanners({ view }: { view: TonightView }) {
  if (view.banners.length === 0 && view.paying === null) return null
  return (
    <div className="space-y-2" data-testid="pause-banners">
      {view.banners.map((banner) =>
        banner.kind === 'restro' ? (
          <RestroBanner key={banner.id} banner={banner} view={view} />
        ) : (
          <StaffBanner key={banner.id} banner={banner} view={view} />
        ),
      )}
      <PayingBanner view={view} />
    </div>
  )
}
