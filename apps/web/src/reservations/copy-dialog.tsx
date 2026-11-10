'use client'

// Copy to another night (#328; D137: "it keeps the details, leaves out arrivals and prepayment, and
// lets the hostess pick other tables when those are taken"). A small dialog over the booking's
// sheet with the three things a copy changes — the night, the hour and the spots — and the same
// advice the booking form gives, so a spot somebody holds that night is named before she copies,
// not after. The guest, the size, the note and the reason are the booking's own and are not asked
// again. A walk-in has no details to keep and is not offered this (the sheet draws no button).
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WRAPS } from '@/lib/wrapping'
import { copyBookingAction } from '@/server/reservations/actions'
import type { RvDetailView, RvFrame } from '@/server/reservations/view'
import { useDateText } from '@/tonight/day-picker'
import { HoursHints } from './booking-form'
import { nextDay } from './booking-values'
import { PickWait, SpotList, usePickPlan } from './spot-picker'
import { useBookingChecks } from './use-booking-checks'
import type { RvRunSpec } from './use-reservation-run'

export function CopyDialog({
  frame,
  detail,
  run,
  busy,
  onClose,
  onCopied,
}: {
  frame: RvFrame
  detail: RvDetailView
  run: (spec: RvRunSpec) => void
  busy: boolean
  onClose: () => void
  onCopied: () => void
}) {
  const t = useTranslations('reservations')
  const dateText = useDateText()
  const first = nextDay(detail.day < frame.today ? frame.today : detail.day)
  const [day, setDay] = useState(first)
  const [time, setTime] = useState(detail.row.time)
  const [spotIds, setSpotIds] = useState<readonly string[]>(detail.spotIds)
  const pick = usePickPlan(frame, day)
  const checks = useBookingChecks({
    venueId: frame.venueId,
    day,
    time,
    // The copy keeps the source's length, as the write does.
    until: '',
    partySize: detail.row.partySize,
    name: detail.row.name ?? '',
    phone: detail.phone ?? '',
    spotIds,
  })

  const copy = () => {
    run({
      id: `rv-copy:${detail.row.id}`,
      done: t('bk_copied', { day: dateText(day) }),
      pin: { title: t('bk_pin_copy'), body: t('bk_pin_b') },
      act: (pin) =>
        copyBookingAction({
          venueId: frame.venueId,
          reservationId: detail.row.id,
          day,
          time,
          spotIds,
          ...(pin === undefined ? {} : { pin }),
        }),
      refusal: (error, details) => {
        if (error !== 'spot_taken' || details === undefined) return null
        const spot = pick.plan?.spots.find((one) => one.id === details.spotId)
        const hold = spot?.holds.find((one) => one.reservationId === details.reservationId)
        if (spot === undefined || hold === undefined) return null
        return hold.kind === 'block'
          ? t('bk_taken_block', { spot: spot.name, time: hold.time })
          : t('bk_taken', { party: hold.name ?? t('no_name'), spot: spot.name, time: hold.time })
      },
      onDone: onCopied,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto" data-testid="rv-copy">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t('bk_copy_t')}</DialogTitle>
          <DialogDescription>
            {t('bk_copy_b', { party: detail.row.name ?? t('no_name') })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="rv-copy-day">{t('bk_night')}</Label>
            <Input
              id="rv-copy-day"
              type="date"
              value={day}
              min={frame.editPastNights ? undefined : frame.today}
              data-testid="rv-copy-day"
              onChange={(event) => event.target.value !== '' && setDay(event.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="rv-copy-time">{t('bk_from')}</Label>
            <Input
              id="rv-copy-time"
              type="time"
              value={time}
              data-testid="rv-copy-time"
              onChange={(event) => event.target.value !== '' && setTime(event.target.value)}
            />
          </div>
        </div>
        {checks === null ? null : <HoursHints checks={checks} />}
        {checks?.sameContact == null ? null : (
          <p className="text-sm text-muted-foreground" role="status" data-testid="rv-copy-same">
            {t('bk_w_same_other', {
              name: checks.sameContact.name ?? t('no_name'),
              time: checks.sameContact.time,
            })}
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">{t('bk_spots')}</legend>
          {checks?.taken == null ? null : (
            <p className="text-sm text-destructive" role="alert" data-testid="rv-copy-taken">
              {checks.taken.kind === 'block'
                ? t('bk_taken_block', { spot: checks.taken.spotName, time: checks.taken.time })
                : t('bk_taken', {
                    party: checks.taken.name ?? t('no_name'),
                    spot: checks.taken.spotName,
                    time: checks.taken.time,
                  })}
            </p>
          )}
          {pick.plan === null ? (
            pick.failed ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {t('p_fail')}
              </p>
            ) : (
              <PickWait />
            )
          ) : pick.plan.planId === null ? (
            <p className="text-sm text-muted-foreground">{t('p_empty')}</p>
          ) : (
            <SpotList plan={pick.plan} selected={spotIds} onChange={setSpotIds} />
          )}
        </fieldset>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={busy}
            data-testid="rv-copy-do"
            onClick={copy}
          >
            {t('bk_copy_do')}
          </Button>
          <Button type="button" variant="ghost" className={WRAPS} onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
