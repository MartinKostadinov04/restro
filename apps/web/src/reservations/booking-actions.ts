'use client'

// The writes on a booking that are one decision each (#328), shared by the list's rows, the
// booking's sheet and the bin, so the same act is worded and signed the same wherever it is made:
//   • No-show — a floor tap (D141): one tap, and the toast's Undo puts the party back to Coming;
//   • Cancel — the guest's doing; it stays on the night as Cancelled and cannot be reopened (the
//     machine has no way back, #323), so it asks once, in a dialog that says so;
//   • Delete — a booking that should never have existed; the Log keeps who and when; a manager's
//     Restore is offered on the toast and lives in the night's bin;
//   • Restore — from the bin.
// Each is a command through `applyService` (rule 1); the PIN sheet is the run hook's, for a shared
// device. Nothing here decides whether a person may: the service path does, inside its own
// transaction, and a refusal comes back as the toast that stays.
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'
import { toast } from 'sonner'

import {
  cancelBookingAction,
  deleteBookingAction,
  noShowAction,
  putBackAction,
  restoreBookingAction,
} from '@/server/reservations/actions'
import type { RvFrame } from '@/server/reservations/view'

import type { RvRunSpec } from './use-reservation-run'

/** The party named in a sentence: its name, or "No name" for a walk-in nobody named. */
export type PartyName = string

export function useBookingActions({
  frame,
  run,
  onChanged,
}: {
  frame: RvFrame
  run: (spec: RvRunSpec) => void
  /** Something was written: the screen behind reads again. */
  onChanged: () => void
}) {
  const t = useTranslations('reservations')
  const venueId = frame.venueId

  const noShow = useCallback(
    (reservationId: string) =>
      run({
        id: `rv-noshow:${reservationId}`,
        done: t('bk_noshow_done'),
        act: () => noShowAction({ venueId, reservationId }),
        again: {
          label: t('p_undo'),
          done: t('bk_noshow_undone'),
          act: () => putBackAction({ venueId, reservationId }),
        },
        after: onChanged,
      }),
    [onChanged, run, t, venueId],
  )

  const cancel = useCallback(
    (reservationId: string, party: PartyName, onDone: () => void) =>
      run({
        id: `rv-cancel:${reservationId}`,
        done: t('bk_cancelled'),
        pin: { title: t('bk_pin_cancel', { party }), body: t('bk_pin_b') },
        act: (pin) =>
          cancelBookingAction({ venueId, reservationId, ...(pin === undefined ? {} : { pin }) }),
        after: onChanged,
        onDone,
      }),
    [onChanged, run, t, venueId],
  )

  const restore = useCallback(
    (reservationId: string, party: PartyName, onDone?: () => void) =>
      run({
        id: `rv-restore:${reservationId}`,
        done: t('bk_restored'),
        pin: { title: t('bk_pin_restore', { party }), body: t('bk_pin_b') },
        act: (pin) =>
          restoreBookingAction({ venueId, reservationId, ...(pin === undefined ? {} : { pin }) }),
        after: onChanged,
        onDone: (details) => {
          // Its table was given away while it was out: it is back, and she is told it has no spot.
          if (details.spotsLost === true) {
            toast.message(t('bk_restored_lost'), { id: `rv-restore-lost:${reservationId}` })
          }
          onDone?.()
        },
      }),
    [onChanged, run, t, venueId],
  )

  const remove = useCallback(
    (reservationId: string, party: PartyName, onDone: () => void) =>
      run({
        id: `rv-delete:${reservationId}`,
        done: t('bk_deleted'),
        pin: { title: t('bk_pin_delete', { party }), body: t('bk_pin_b') },
        act: (pin) =>
          deleteBookingAction({ venueId, reservationId, ...(pin === undefined ? {} : { pin }) }),
        // A manager can bring it back at once from the toast; anyone else finds it in the bin.
        ...(frame.can.manage || frame.device
          ? {
              again: {
                label: t('p_undo'),
                done: t('bk_restored'),
                act: (pin?: string) =>
                  restoreBookingAction({
                    venueId,
                    reservationId,
                    ...(pin === undefined ? {} : { pin }),
                  }),
              },
            }
          : {}),
        after: onChanged,
        onDone,
      }),
    [frame.can.manage, frame.device, onChanged, run, t, venueId],
  )

  return { noShow, cancel, restore, remove }
}
