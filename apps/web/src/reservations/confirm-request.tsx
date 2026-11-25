'use client'

// Confirming an online request (#578; spec #322, Implementation Decision 2): "Choose then act". The
// hostess chooses the spots the party gets, on the plan or in the named list exactly as the booking
// form offers them, then taps the one filled button. The choice starts from what the request
// already holds (a guest who picked a spot on the booking page), so a request with its spot is
// confirmed in one tap.
//
// Every spot is offered with its state in words, never hidden: the write claims them by the
// booking rule, and a spot somebody took while the request waited is refused `spot_taken` with a
// sentence naming who holds it (the booking form's own words), the dialog staying open on her
// choice so she picks another.
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
} from '@/components/ui/dialog'
import { WRAPS } from '@/lib/wrapping'
import type { RvDetailView, RvFrame } from '@/server/reservations/view'
import { NoPlanYet } from './no-plan'
import { PickWait, SpotList, SpotPlan, usePickerWay, usePickPlan } from './spot-picker'
import type { RvRunSpec } from './use-reservation-run'

export function ConfirmRequestDialog({
  frame,
  detail,
  busy,
  onConfirm,
  onClose,
}: {
  frame: RvFrame
  detail: RvDetailView
  busy: boolean
  /** Confirms with the spots chosen; `refusal` words a spot somebody took meanwhile. */
  onConfirm: (spotIds: readonly string[], refusal: NonNullable<RvRunSpec['refusal']>) => void
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const [picker, setPicker] = usePickerWay()
  const pick = usePickPlan(frame, detail.day)
  const [selected, setSelected] = useState<readonly string[]>(detail.spotIds)
  const party = detail.row.name ?? t('no_name')

  // A spot taken while the request waited: the party or the block that holds it, by name.
  const refusal: NonNullable<RvRunSpec['refusal']> = (error, details) => {
    if (error !== 'spot_taken' || details === undefined) return null
    // The plan is read again so its tiles show the spot as taken now.
    pick.reload()
    const spot = pick.plan?.spots.find((one) => one.id === details.spotId)
    const hold = spot?.holds.find((one) => one.reservationId === details.reservationId)
    if (spot === undefined || hold === undefined) return null
    return hold.kind === 'block'
      ? t('bk_taken_block', { spot: spot.name, time: hold.time })
      : t('bk_taken', { party: hold.name ?? t('no_name'), spot: spot.name, time: hold.time })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto" data-testid="rv-confirm">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            {t('rq_confirm_t', { party })}
          </DialogTitle>
          <DialogDescription>{t('rq_confirm_b')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={picker === 'plan' ? 'default' : 'outline'}
            aria-pressed={picker === 'plan'}
            className={WRAPS}
            data-testid="rv-confirm-plan"
            onClick={() => setPicker('plan')}
          >
            {t('bk_spots_plan')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={picker === 'list' ? 'default' : 'outline'}
            aria-pressed={picker === 'list'}
            className={WRAPS}
            data-testid="rv-confirm-list"
            onClick={() => setPicker('list')}
          >
            {t('bk_spots_pick')}
          </Button>
        </div>
        <div aria-busy={busy}>
          {pick.plan === null ? (
            pick.failed ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {t('p_fail')}
              </p>
            ) : (
              <PickWait />
            )
          ) : pick.plan.planId === null || pick.plan.spots.length === 0 ? (
            <NoPlanYet frame={frame} noSpots={pick.plan.planId !== null} />
          ) : picker === 'list' ? (
            <SpotList plan={pick.plan} selected={selected} onChange={setSelected} />
          ) : (
            <SpotPlan plan={pick.plan} selected={selected} onChange={setSelected} />
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={busy}
            data-testid="rv-confirm-do"
            onClick={() => onConfirm(selected, refusal)}
          >
            {t('rq_confirm')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={WRAPS}
            data-testid="rv-confirm-close"
            onClick={onClose}
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
