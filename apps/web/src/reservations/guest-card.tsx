'use client'

// One guest, everything about him (#333; D140; Patterns: "Everything about one thing"): a side
// sheet on the tablet, a bottom drawer on a phone, over Venue › Reservations › Guests and reached
// from a reservation's sheet too. His name, phone, email and note; how often he came and did not
// come, from this venue's nights only, said as a rough count and never added up into one number;
// his recent bookings. "Book a table" is the primary action.
//
// **The manager's own list** is a section only its keeper sees: the read leaves it out for anybody
// else (the card's `mine` is null), so a colleague's screen has nothing to hide.
//
// **Erasing** is settings-class (D141): the person's own sign-in, never a PIN. On a shared device
// the card says so in one line instead of offering it. The dialog says what goes, what stays, and
// that the card payment provider keeps its own record — one string, worded once.
import { EllipsisIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { WRAPS } from '@/lib/wrapping'
import {
  eraseGuestAction,
  guestCardAction,
  privateNoteAction,
  saveGuestAction,
} from '@/server/reservations/actions'
import type { RvFrame, RvGuestCardView } from '@/server/reservations/view'
import { useSettingsRun } from '@/settings/use-settings-run'
import { useDateText } from '@/tonight/day-picker'
import { READ_FAILED, readAttempt } from '@/tonight/read-attempt'
import { ReadFailed } from '@/tonight/tab-parts'

import { ConfirmDialog } from './confirm-dialog'
import { useGuestsText, useStatusWord } from './reservation-words'
import { type RvRunSpec, useRvFailureText } from './use-reservation-run'

/** One labelled line; nothing is drawn where there is nothing to say. */
function Line({ label, value, testId }: { label: string; value: string | null; testId: string }) {
  if (value === null || value === '') return null
  return (
    <p className="[overflow-wrap:anywhere]" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span> {value}
    </p>
  )
}

/** The fields of the card's edit, as typed. */
interface Fields {
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly note: string
}

const fieldsOf = (card: RvGuestCardView): Fields => ({
  name: card.name ?? '',
  phone: card.phone ?? '',
  email: card.email ?? '',
  note: card.note ?? '',
})

/** The reader's own list: a note only they see, kept or taken off (D140). */
function MyList({
  venueId,
  card,
  email,
  onChanged,
}: {
  venueId: string
  card: RvGuestCardView
  email: string
  onChanged: () => void
}) {
  const t = useTranslations('reservations')
  const failure = useRvFailureText()
  const ids = useId()
  const runner = useSettingsRun(email)
  const [note, setNote] = useState(card.mine?.note ?? '')
  const mine = card.mine
  if (mine === null) return null
  const words = (error: string) => failure(error)
  return (
    <section className="space-y-2 rounded-lg border p-3" data-testid="rv-g-mine">
      <h3 className="font-medium">{t('g_mine')}</h3>
      <p className="text-muted-foreground">{t('g_mine_hint')}</p>
      <Label htmlFor={`${ids}-mine`}>{t('g_note')}</Label>
      <Textarea
        id={`${ids}-mine`}
        value={note}
        maxLength={500}
        rows={2}
        data-testid="rv-g-mine-note"
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={runner.pending || note.trim() === ''}
          data-testid="rv-g-mine-save"
          onClick={() =>
            runner.run(() => privateNoteAction({ venueId, guestId: card.id, note: note.trim() }), {
              done: t('g_mine_saved'),
              onOk: onChanged,
              words,
            })
          }
        >
          {mine.onList ? t('g_mine_save') : t('g_mine_add')}
        </Button>
        {mine.onList ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            disabled={runner.pending}
            data-testid="rv-g-mine-remove"
            onClick={() =>
              runner.run(() => privateNoteAction({ venueId, guestId: card.id, note: null }), {
                done: t('g_mine_removed'),
                onOk: () => {
                  setNote('')
                  onChanged()
                },
                words,
              })
            }
          >
            {t('g_mine_remove')}
          </Button>
        ) : null}
      </div>
      {runner.dialog}
    </section>
  )
}

/** The card's details, read-only. */
function Details({ card }: { card: RvGuestCardView }) {
  const t = useTranslations('reservations')
  const dateText = useDateText()
  const guests = useGuestsText()
  const word = useStatusWord()
  return (
    <>
      <Line label={t('sh_phone')} value={card.phone} testId="rv-g-phone" />
      <Line label={t('sh_email')} value={card.email} testId="rv-g-email" />
      <Line label={t('g_note')} value={card.note} testId="rv-g-note" />
      <section className="space-y-1" data-testid="rv-g-counts">
        <p className="[overflow-wrap:anywhere]">
          {t('g_counts', { n: card.came, m: card.missed })}
        </p>
        <p className="text-muted-foreground">{t('g_counts_note')}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-medium">{t('g_bookings')}</h3>
        {card.bookings.length === 0 ? (
          <p className="text-muted-foreground">{t('g_no_bookings')}</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="rv-g-bookings">
            {card.bookings.map((one) => (
              <li key={one.id} className="space-y-0.5 p-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">
                    {dateText(one.day)} · {one.time}
                  </span>
                  <Badge variant="outline">{word(one.status)}</Badge>
                </p>
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  {[guests(one.partySize), one.spots.join(', ')]
                    .filter((part): part is string => part !== null && part !== '')
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/** The card's edit: the four things the venue's list holds about a guest. */
function EditFields({ fields, set }: { fields: Fields; set: (next: Fields) => void }) {
  const t = useTranslations('reservations')
  const ids = useId()
  const field = (
    key: keyof Fields,
    label: string,
    input: Partial<React.ComponentProps<'input'>>,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${ids}-${key}`}>{label}</Label>
      <Input
        id={`${ids}-${key}`}
        value={fields[key]}
        autoComplete="off"
        data-testid={`rv-g-f-${key}`}
        onChange={(event) => set({ ...fields, [key]: event.target.value })}
        {...input}
      />
    </div>
  )
  return (
    <div className="space-y-3" data-testid="rv-g-edit">
      {field('name', t('bk_name'), { maxLength: 80 })}
      {field('phone', t('bk_phone'), { type: 'tel', inputMode: 'tel', maxLength: 40 })}
      {field('email', t('g_email_opt'), { type: 'email', maxLength: 200 })}
      <div className="space-y-1.5">
        <Label htmlFor={`${ids}-note`}>{t('g_note')}</Label>
        <Textarea
          id={`${ids}-note`}
          value={fields.note}
          maxLength={500}
          rows={2}
          data-testid="rv-g-f-note"
          onChange={(event) => set({ ...fields, note: event.target.value })}
        />
      </div>
    </div>
  )
}

export function GuestCard({
  frame,
  guestId,
  email,
  run,
  busy,
  onBook,
  onChanged,
  onClose,
}: {
  frame: RvFrame
  guestId: string
  /** The signed-in person's, for the password asked again before an erasure (D122 §7). */
  email: string
  run: (spec: RvRunSpec) => void
  busy: boolean
  /** "Book a table": the booking form, opened with his name and phone. */
  onBook: (guest: { name: string; phone: string }) => void
  /** Something about the guest changed: the list behind reads again. */
  onChanged: () => void
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const isMobile = useIsMobile()
  const failure = useRvFailureText()
  const eraser = useSettingsRun(email)
  // undefined while loading; null when the venue has no such guest any more (erased).
  const [card, setCard] = useState<RvGuestCardView | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Fields | null>(null)
  const [erasing, setErasing] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    void readAttempt(() => guestCardAction({ venueId: frame.venueId, guestId })).then((result) => {
      if (result === READ_FAILED) {
        setFailed(true)
        return
      }
      setCard(result.ok ? result.card : null)
    })
  }, [frame.venueId, guestId])
  useEffect(() => load(), [load])

  const changed = () => {
    load()
    onChanged()
  }
  const name = card?.name ?? t('no_name')
  const pin = { title: t('g_pin'), body: t('g_pin_b') }

  /** The sentence for a phone another guest already has: it names him (#333). */
  const existsText = async (
    error: string,
    details: Readonly<Record<string, unknown>> | undefined,
  ): Promise<string | null> => {
    if (error !== 'guest_exists' || typeof details?.guestId !== 'string') return null
    const other = await guestCardAction({ venueId: frame.venueId, guestId: details.guestId }).catch(
      () => null,
    )
    return other?.ok && other.card !== null
      ? t('g_listed', { name: other.card.name ?? t('no_name') })
      : null
  }

  const saveEdit = (fields: Fields) => {
    if (card === null || card === undefined) return
    const trimmed = {
      name: fields.name.trim(),
      phone: fields.phone.trim(),
      email: fields.email.trim(),
      note: fields.note.trim(),
    }
    run({
      id: `rv-guest:${card.id}`,
      done: t('g_saved'),
      pin,
      act: (typed) =>
        saveGuestAction({
          venueId: frame.venueId,
          guestId: card.id,
          ...(trimmed.name === '' || trimmed.name === (card.name ?? '')
            ? {}
            : { name: trimmed.name }),
          ...(trimmed.phone === '' || trimmed.phone === (card.phone ?? '')
            ? {}
            : { phone: trimmed.phone }),
          ...(trimmed.email === (card.email ?? '')
            ? {}
            : { email: trimmed.email === '' ? null : trimmed.email }),
          ...(trimmed.note === (card.note ?? '')
            ? {}
            : { note: trimmed.note === '' ? null : trimmed.note }),
          ...(typed === undefined ? {} : { pin: typed }),
        }),
      refusal: existsText,
      onDone: () => setEditing(null),
      after: changed,
    })
  }

  const setArchived = (archived: boolean) => {
    if (card === null || card === undefined) return
    const act = (value: boolean) => (typed?: string) =>
      saveGuestAction({
        venueId: frame.venueId,
        guestId: card.id,
        archived: value,
        ...(typed === undefined ? {} : { pin: typed }),
      })
    run({
      id: `rv-guest-archive:${card.id}`,
      done: archived ? t('g_archived_done', { name }) : t('g_restored_done', { name }),
      pin,
      act: act(archived),
      again: {
        label: t('p_undo'),
        done: archived ? t('g_restored_done', { name }) : t('g_archived_done', { name }),
        act: act(!archived),
      },
      after: changed,
    })
  }

  const erase = () => {
    if (card === null || card === undefined) return
    eraser.run(() => eraseGuestAction({ venueId: frame.venueId, guestId: card.id }), {
      done: t('g_erased'),
      words: (error) => failure(error),
      onOk: () => {
        setErasing(false)
        onChanged()
        onClose()
      },
      onFail: () => setErasing(false),
    })
  }

  const mayWork = frame.can.tonight || frame.device
  const mayErase = frame.can.guests && !frame.device
  const title = card ? name : failed ? t('g_fail_t') : card === null ? t('g_gone_t') : t('loading')
  const sub = card
    ? [card.regular ? t('g_regular') : null, card.archived ? t('g_archived') : null]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : ''

  const body = card ? (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="rv-g-body">
      {editing === null ? (
        <Details card={card} />
      ) : (
        <EditFields fields={editing} set={setEditing} />
      )}
      {editing === null ? (
        <MyList
          venueId={frame.venueId}
          card={card}
          email={email}
          // The card and the list behind it: the list's "On my list" badge and filter follow.
          onChanged={() => {
            load()
            onChanged()
          }}
        />
      ) : null}
      {editing === null && frame.can.guests && frame.device ? (
        <p className="text-muted-foreground" data-testid="rv-g-erase-signin">
          {t('g_erase_signin')}
        </p>
      ) : null}
    </div>
  ) : failed ? (
    <ReadFailed onRetry={load} />
  ) : card === null ? (
    <p className="px-4 text-sm text-muted-foreground" data-testid="rv-g-gone">
      {t('g_gone')}
    </p>
  ) : null

  const buttons =
    card && editing !== null ? (
      <>
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-g-save"
          onClick={() => saveEdit(editing)}
        >
          {t('bk_save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          data-testid="rv-g-edit-back"
          onClick={() => setEditing(null)}
        >
          {t('g_edit_back')}
        </Button>
      </>
    ) : (
      <>
        {card && mayWork && !card.archived && card.phone !== null ? (
          <Button
            type="button"
            className={WRAPS}
            data-testid="rv-g-book"
            onClick={() => onBook({ name: card.name ?? '', phone: card.phone ?? '' })}
          >
            {t('g_book')}
          </Button>
        ) : null}
        {card && mayWork ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPS}
            data-testid="rv-g-edit-open"
            onClick={() => setEditing(fieldsOf(card))}
          >
            {t('bk_edit')}
          </Button>
        ) : null}
        {card && (mayWork || mayErase) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={WRAPS}
                data-testid="rv-g-more"
                aria-label={t('bk_more')}
              >
                <EllipsisIcon aria-hidden />
                {t('bk_more')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mayWork ? (
                <DropdownMenuItem
                  className="min-h-11"
                  data-testid={card.archived ? 'rv-g-restore' : 'rv-g-archive'}
                  onSelect={() => setArchived(!card.archived)}
                >
                  {card.archived ? t('g_restore') : t('g_archive')}
                </DropdownMenuItem>
              ) : null}
              {mayErase ? (
                <DropdownMenuItem
                  className="min-h-11"
                  data-testid="rv-g-erase"
                  onSelect={() => setErasing(true)}
                >
                  {t('g_erase')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-12"
          data-testid="rv-g-close"
          onClick={onClose}
        >
          {t('close')}
        </Button>
      </>
    )

  return (
    <>
      {isMobile ? (
        <Drawer open onOpenChange={(open) => !open && onClose()}>
          <DrawerContent data-testid="rv-guest" aria-busy={card === undefined}>
            <DrawerHeader>
              <DrawerTitle className="[overflow-wrap:anywhere]">{title}</DrawerTitle>
              <DrawerDescription className={sub === '' ? 'sr-only' : undefined}>
                {sub === '' ? title : sub}
              </DrawerDescription>
            </DrawerHeader>
            {body}
            <DrawerFooter>{buttons}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent data-testid="rv-guest" aria-busy={card === undefined}>
            <SheetHeader>
              <SheetTitle className="[overflow-wrap:anywhere]">{title}</SheetTitle>
              <SheetDescription className={sub === '' ? 'sr-only' : undefined}>
                {sub === '' ? title : sub}
              </SheetDescription>
            </SheetHeader>
            {body}
            <SheetFooter>{buttons}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      {erasing && card ? (
        <ConfirmDialog
          testId="rv-g-erase-dialog"
          title={t('g_erase_t', { name })}
          body={t('g_erase_b')}
          doLabel={t('g_erase_do')}
          keepLabel={t('g_erase_keep')}
          busy={eraser.pending}
          onKeep={() => setErasing(false)}
          onDo={erase}
        />
      ) : null}
      {eraser.dialog}
    </>
  )
}
