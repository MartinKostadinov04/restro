'use client'

// The two questions the door asks before it writes (#329; Patterns: "A write the person must
// accept the consequence of"), and the one field it asks for afterwards.
//
// **The same-guests question** is the one place in Restro where neither answer is the safer one, so
// it is not the usual do/keep dialog: both answers are buttons of the same weight, each with the
// consequence written under it in one line. Nothing is pre-selected and nothing is a default —
// closing the dialog seats nobody. The write refuses `same_guests_unanswered` if this question is
// ever got round, so the screen cannot decide it by accident either (#329).
//
// **The count** is the ticket's "Add a thing": one field, then the write. It is asked after the
// guests are already sitting, never at the door.
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
import { Label } from '@/components/ui/label'
import { WRAPS } from '@/lib/wrapping'

/** One answer: the words on the button, and what it does, under it. */
function Answer({
  label,
  body,
  testId,
  busy,
  onPick,
}: {
  label: string
  body: string
  testId: string
  busy: boolean
  onPick: () => void
}) {
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        className="h-auto w-full justify-start whitespace-normal py-3 text-left text-base"
        disabled={busy}
        data-testid={testId}
        onClick={onPick}
      >
        {label}
      </Button>
      <p className="px-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{body}</p>
    </div>
  )
}

/**
 * "Are these the same guests?" — asked whenever a party is seated onto a table whose codes are
 * already open. Yes keeps the sitting, its order and the phones that are on it; no sends the
 * "New guests" the floor already has, which ends the sitting and empties the order.
 */
export function SameGuestsDialog({
  busy,
  onAnswer,
  onLeave,
}: {
  busy: boolean
  onAnswer: (sameGuests: boolean) => void
  onLeave: () => void
}) {
  const t = useTranslations('reservations')
  return (
    <Dialog open onOpenChange={(open) => !open && onLeave()}>
      <DialogContent className="max-w-md" data-testid="rv-same-guests">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t('d_same_t')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {t('d_same_b')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Answer
            label={t('d_same_keep')}
            body={t('d_same_keep_b')}
            testId="rv-same-keep"
            busy={busy}
            onPick={() => onAnswer(true)}
          />
          <Answer
            label={t('d_same_new')}
            body={t('d_same_new_b')}
            testId="rv-same-new"
            busy={busy}
            onPick={() => onAnswer(false)}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className={WRAPS}
            data-testid="rv-same-leave"
            onClick={onLeave}
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** How many guests: one field, then the write. Prefilled with what the party was down for. */
export function GuestsDialog({
  party,
  partySize,
  busy,
  onSave,
  onLeave,
}: {
  /** The party, for the dialog's own line. */
  party: string
  /** What it is down for now; null for a walk-in nobody counted. */
  partySize: number | null
  busy: boolean
  onSave: (guests: number) => void
  onLeave: () => void
}) {
  const t = useTranslations('reservations')
  const [guests, setGuests] = useState(partySize === null ? '' : String(partySize))
  const count = Number.parseInt(guests, 10)
  const good = Number.isInteger(count) && count >= 1 && count <= 500

  return (
    <Dialog open onOpenChange={(open) => !open && onLeave()}>
      <DialogContent className="max-w-sm" data-testid="rv-guests-dialog">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t('d_guests_t')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{party}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rv-guests">{t('bk_guests')}</Label>
          <input
            id="rv-guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            // The dialog has one field and the keyboard belongs in it (Patterns: "Add a thing").
            autoFocus
            className="h-11 w-24 min-w-0 rounded-md border bg-background px-3 text-base tabular-nums"
            value={guests}
            data-testid="rv-guests-field"
            onChange={(event) => setGuests(event.target.value)}
          />
          {guests !== '' && !good ? (
            <p className="text-sm text-destructive" data-testid="rv-guests-error">
              {t('bk_e_guests')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={!good || busy}
            data-testid="rv-guests-save"
            onClick={() => good && onSave(count)}
          >
            {t('bk_save')}
          </Button>
          <Button type="button" variant="ghost" className={WRAPS} onClick={onLeave}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
