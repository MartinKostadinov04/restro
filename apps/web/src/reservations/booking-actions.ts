'use client'

import type { PayRule } from '@restro/core'
// The writes on a booking that are one decision each (#328), shared by the list's rows, the
// booking's sheet and the bin, so the same act is worded and signed the same wherever it is made:
//   • No-show — a floor tap (D141): one tap, and the toast's Undo puts the party back to Coming;
//   • Cancel — the guest's doing; it stays on the night as Cancelled and cannot be reopened (the
//     machine has no way back, #323), so it asks once, in a dialog that says so;
//   • Delete — a booking that should never have existed; the Log keeps who and when; a manager's
//     Restore is offered on the toast and lives in the night's bin;
//   • Restore — from the bin;
//   • Put back — one party the night's end closed (#332), an admin's: no question, the toast's Undo
//     is the safety net, and there is no way to put a whole night back.
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
  setPayRuleAction,
  undoPutBackAction,
} from '@/server/reservations/actions'
import type { RvFrame } from '@/server/reservations/view'

import { usePayRuleWord } from './reservation-words'
import type { RvRunSpec } from './use-reservation-run'

/** The party named in a sentence: its name, or "No name" for a walk-in nobody named. */
export type PartyName = string

/** What setting a party's pay rule needs of the sheet (#334). */
export interface PayRuleChange {
  readonly reservationId: string
  readonly party: PartyName
  /** The rule chosen; null takes it away and the club's own rule applies again. */
  readonly rule: PayRule | null
  /** What it was, which the toast's Undo writes back. */
  readonly previous: PayRule | null
  /** The version the sheet was read on: a save over a newer one is refused. */
  readonly version: string
  /** The write is over, whatever the answer: the sheet reads again and drops its guess. */
  readonly settled: () => void
}

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
  const ruleWord = usePayRuleWord()
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

  /**
   * The pay rule this party carries (#334): the card is tapped and the write goes at once, with
   * Undo on the toast — the rule is one word about one party and costs nothing to put back, so a
   * dialog in front of it would be in the way (D123). The version the sheet was read on goes with
   * it, so a choice made on a stale sheet is refused rather than saving over somebody else's; the
   * Undo carries no version, because by then the version is this very write's.
   */
  const payRule = useCallback(
    ({ reservationId, party, rule, previous, version, settled }: PayRuleChange) =>
      run({
        id: `rv-pay-rule:${reservationId}`,
        done: t('pr_done', { rule: ruleWord(rule) }),
        pin: { title: t('pr_pin', { party }), body: t('bk_pin_b') },
        act: (pin) =>
          setPayRuleAction({
            venueId,
            reservationId,
            rule,
            expectedVersion: version,
            ...(pin === undefined ? {} : { pin }),
          }),
        again: {
          label: t('p_undo'),
          done: t('pr_done', { rule: ruleWord(previous) }),
          act: (pin?: string) =>
            setPayRuleAction({
              venueId,
              reservationId,
              rule: previous,
              ...(pin === undefined ? {} : { pin }),
            }),
        },
        after: () => {
          settled()
          onChanged()
        },
      }),
    [onChanged, run, ruleWord, t, venueId],
  )

  /**
   * "Put back" on a party the night's end closed (#332): one write, no dialog, the toast's Undo
   * returns it to the status the night's end gave it. A shared device names the person first.
   */
  const putBack = useCallback(
    (reservationId: string, party: PartyName, onDone: () => void) =>
      run({
        id: `rv-put-back:${reservationId}`,
        done: t('pb_done', { party }),
        pin: { title: t('pb_pin', { party }), body: t('bk_pin_b') },
        act: (pin) =>
          putBackAction({ venueId, reservationId, ...(pin === undefined ? {} : { pin }) }),
        again: {
          label: t('p_undo'),
          done: t('pb_undone'),
          act: (pin?: string) =>
            undoPutBackAction({ venueId, reservationId, ...(pin === undefined ? {} : { pin }) }),
        },
        after: onChanged,
        onDone,
      }),
    [onChanged, run, t, venueId],
  )

  return { noShow, cancel, restore, remove, payRule, putBack }
}
