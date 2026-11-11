'use client'

// "Give a spot" (#330; D137): the one act the waiting list has of its own. The hostess opens it
// from a waiting party's row, taps a spot, and the party is **seated** on it in the same move —
// through the arrival path of #329, so the table's codes open and nothing here writes anything
// itself. There is no Select and no second button: the tap on the spot is the choice and the act
// (Patterns: "A choice that is also the action"), which is what keeps the story at three taps.
//
// The plan opens first, because a hostess looking for a free table is looking at the room; the
// named list is one tap away for a long plan or a phone in one hand. Every spot is offered, with
// its state in words, exactly as the booking form offers them: she may be putting a party onto a
// table whose own guests are leaving, and the write refuses a spot somebody is on with a sentence
// that names them (`spot_taken`), rather than the plan hiding it from her now.
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
import type { RvFrame, RvWaitingView } from '@/server/reservations/view'

import { NoPlanYet } from './no-plan'
import { PickWait, SpotList, SpotPlan, usePickPlan } from './spot-picker'

export function GiveSpotDialog({
  frame,
  day,
  party,
  waited,
  busy,
  onGive,
  onClose,
}: {
  frame: RvFrame
  /** The night the queue belongs to: the plan read is that night's. */
  day: string
  party: RvWaitingView
  /** How long they have waited, in words; null where the night shown is not tonight. */
  waited: string | null
  busy: boolean
  /** The spot she tapped: it seats the party there, in one move. */
  onGive: (spot: { readonly id: string; readonly name: string }) => void
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const [picker, setPicker] = useState<'plan' | 'list'>('plan')
  const pick = usePickPlan(frame, day)
  const named = party.name ?? t('no_name')
  // The tap arrives as the list of chosen spots, which was empty: the one it added is the spot.
  const tapped = (ids: readonly string[]) => {
    const spot = pick.plan?.spots.find((one) => one.id === ids[0])
    if (spot !== undefined) onGive({ id: spot.id, name: spot.name })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto" data-testid="rv-give">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            {t('w_pick_t', { party: named })}
          </DialogTitle>
          <DialogDescription>
            {waited === null
              ? t('bk_spots_pick')
              : t('w_waited', { party: named, duration: waited })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={picker === 'plan' ? 'default' : 'outline'}
            aria-pressed={picker === 'plan'}
            className={WRAPS}
            data-testid="rv-give-plan"
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
            data-testid="rv-give-list"
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
            <SpotList plan={pick.plan} selected={[]} onChange={tapped} />
          ) : (
            <SpotPlan plan={pick.plan} selected={[]} onChange={tapped} />
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className={WRAPS}
            data-testid="rv-give-close"
            onClick={onClose}
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
