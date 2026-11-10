'use client'

// "Add a party" (#330; D137): the waiting list's own door, and the only way a party reaches the
// list by hand. A booking with no spot yet is a booking (#328) and is taken on the booking form —
// nothing here is reached from there.
//
// It is the ticket's "Add a thing": the few fields a party at the door actually has, and then the
// write. No hour, because a party on the list waits from the moment it is written down and is
// seated by being given a spot; no spot, because having none is what the list is. The name and the
// number are both optional — a party at the door has often given neither — so the count is the one
// field that must be right, and Save says which field is wrong rather than going grey.
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
import { Textarea } from '@/components/ui/textarea'
import { WRAPS } from '@/lib/wrapping'
import { BOOKING_REASONS, type BookingReason } from './booking-reasons'
import { phoneLooksRight } from './booking-values'

/** What the hostess wrote down: the party as the list will hold it. */
export interface WaitingDraft {
  readonly name: string
  readonly phone: string
  readonly partySize: number
  readonly note: string
  readonly reason: BookingReason | null
}

export function WaitingForm({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean
  onSave: (draft: WaitingDraft) => void
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [guests, setGuests] = useState('2')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState<BookingReason | null>(null)
  const [tried, setTried] = useState(false)

  const typedPhone = phone.trim()
  const count = Number.parseInt(guests, 10)
  const badGuests = !Number.isInteger(count) || count < 1 || count > 500
  const badPhone = typedPhone !== '' && !phoneLooksRight(typedPhone)
  const save = () => {
    setTried(true)
    if (badGuests) {
      document.getElementById('rv-wl-guests')?.focus()
      return
    }
    if (badPhone) {
      document.getElementById('rv-wl-phone')?.focus()
      return
    }
    onSave({ name: name.trim(), phone: typedPhone, partySize: count, note: note.trim(), reason })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto" data-testid="rv-wl-form">
        <DialogHeader>
          <DialogTitle>{t('w_add')}</DialogTitle>
          <DialogDescription>{t('w_add_b')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rv-wl-name">{t('w_name_opt')}</Label>
            <Input
              id="rv-wl-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              // One form, and the name is where she starts writing (Patterns: "Add a thing").
              autoFocus
              data-testid="rv-wl-name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-wl-phone">{t('bk_phone_opt')}</Label>
            <Input
              id="rv-wl-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              maxLength={40}
              autoComplete="off"
              data-testid="rv-wl-phone"
              onChange={(event) => setPhone(event.target.value)}
            />
            {tried && badPhone ? (
              <p className="text-sm text-destructive" data-testid="rv-wl-e-phone">
                {t('bk_e_phone_digits')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-wl-guests">{t('bk_guests')}</Label>
            <Input
              id="rv-wl-guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              className="w-24 tabular-nums"
              value={guests}
              data-testid="rv-wl-guests"
              onChange={(event) => setGuests(event.target.value)}
            />
            {tried && badGuests ? (
              <p className="text-sm text-destructive" data-testid="rv-wl-e-guests">
                {t('bk_e_guests')}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-wl-note">{t('bk_note')}</Label>
            <Textarea
              id="rv-wl-note"
              value={note}
              maxLength={500}
              rows={2}
              data-testid="rv-wl-note"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 font-medium">{t('bk_reason')}</legend>
            <div className="flex min-w-0 flex-wrap gap-2">
              {BOOKING_REASONS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={reason === value ? 'default' : 'outline'}
                  aria-pressed={reason === value}
                  className="min-h-11"
                  data-testid={`rv-wl-reason-${value}`}
                  // A second tap takes it away again: most parties at the door have no occasion.
                  onClick={() => setReason(reason === value ? null : value)}
                >
                  {t(`bk_reason_${value}`)}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button
            type="button"
            className={WRAPS}
            disabled={busy}
            data-testid="rv-wl-save"
            onClick={save}
          >
            {t('bk_save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={WRAPS}
            data-testid="rv-wl-close"
            onClick={onClose}
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
