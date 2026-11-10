'use client'

// One reservation, everything about it (#326; Patterns: "Everything about one thing"): a side
// sheet on the tablet, a bottom drawer on a phone. The party and its hours, the spots it holds,
// the note, who took it, and its whole history in the Log's own words — the Log and this sheet
// never word the same event differently (D141, rule 1: one Log). No money section: the record is
// filled in part 2, and an empty section is noise on a hostess's screen.
//
// It keeps itself current while it is open. When someone else changes the reservation meanwhile,
// the sheet says who and shows their version: it writes nothing itself. The booking's own life is
// here (#328): Edit is the primary action; Cancel is beside it, because a hostess does it often;
// Copy to another night, No-show and Delete are under "…" (Patterns: the secondary actions of a
// thing). A role that may not change the booking is told who may, in one line, never shown a
// disabled control; on a shared device the controls are there and the PIN sheet names the person.
//
// Calling the guest is one tap here and nowhere else: the number is read for this sheet alone and
// never travels with the night's list. Closing loses nothing.
import { EllipsisIcon, PhoneIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { WRAPS } from '@/lib/wrapping'
import { reservationDetailAction } from '@/server/reservations/actions'
import type { RvDetailView, RvFrame } from '@/server/reservations/view'
import type { WhoView } from '@/server/tonight/night-view'
import { useDateText } from '@/tonight/day-picker'
import { FEED_POLL_MS } from '@/tonight/live-feed'
import { READ_FAILED, readAttempt } from '@/tonight/read-attempt'
import { ReadFailed } from '@/tonight/tab-parts'
import { useWho } from '@/tonight/who'

import type { PartyName } from './booking-actions'
import { ConfirmDialog } from './confirm-dialog'
import { useByClubWord, useGuestsText, useHistoryText, useStatusWord } from './reservation-words'

/** One labelled line of the sheet; nothing is drawn where there is nothing to say. */
function Line({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null
  return (
    <p className="[overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{label}</span> {value}
    </p>
  )
}

function Body({
  detail,
  changedBy,
  sayWhoManages,
}: {
  detail: RvDetailView
  changedBy: WhoView | null
  /** This role may take a booking but not change one: one line says who may. */
  sayWhoManages: boolean
}) {
  const t = useTranslations('reservations')
  const word = useStatusWord()
  const guests = useGuestsText()
  const byClub = useByClubWord()
  const sentence = useHistoryText()
  const who = useWho()
  const { row } = detail
  const history = detail.history
    .map((line) => ({ line, words: sentence(line) }))
    .filter((one): one is { line: typeof one.line; words: string } => one.words !== null)

  return (
    <div className="space-y-4 overflow-y-auto px-4 text-sm" data-testid="rv-sheet-body">
      {changedBy === null ? null : (
        <p
          role="status"
          className="rounded-md border bg-info/10 p-3 [overflow-wrap:anywhere]"
          data-testid="rv-stale"
        >
          {t('stale', { name: who(changedBy) })}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{word(row.status)}</Badge>
        {byClub(row) === null ? null : (
          <span className="text-muted-foreground" data-testid="rv-sheet-by-club">
            {byClub(row)}
          </span>
        )}
        {row.late ? <Badge variant="danger">{t('s_late')}</Badge> : null}
        {row.kind === 'walk_in' ? (
          <span className="text-muted-foreground">{t('walk_in')}</span>
        ) : null}
      </p>
      <Line label={t('sh_party')} value={guests(row.partySize)} />
      <Line
        label={t('sh_spots')}
        value={row.spots.length === 0 ? t('sh_no_spots') : row.spots.join(', ')}
      />
      <Line label={t('sh_until')} value={row.until} />
      <Line label={t('sh_arrived')} value={row.seatedAt} />
      <Line label={t('sh_left')} value={row.endedAt} />
      <Line label={t('sh_note')} value={row.note} />
      <Line label={t('sh_made')} value={detail.made === null ? null : who(detail.made)} />
      <Line label={t('sh_phone')} value={detail.phone ?? t('no_phone')} />
      <Line label={t('sh_email')} value={detail.email} />
      {sayWhoManages ? (
        <p className="text-muted-foreground" data-testid="rv-only-managers">
          {t('bk_only_managers')}
        </p>
      ) : null}
      {history.length === 0 ? null : (
        <section className="space-y-1">
          <h3 className="font-medium">{t('sh_history')}</h3>
          <ul className="space-y-1 text-muted-foreground" data-testid="rv-history">
            {history.map(({ line, words }) => (
              <li key={line.seq} className="[overflow-wrap:anywhere]">
                <span className="tabular-nums">{line.time}</span>
                {' · '}
                {words}
                {' · '}
                {who(line.by)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The states a booking is over in: nothing is changed on it any more. */
const ENDED = ['finished', 'no_show', 'cancelled', 'not_seated'] as const

export function ReservationSheet({
  frame,
  reservationId,
  writable,
  busy,
  onEdit,
  onCopy,
  onNoShow,
  onCancel,
  onDelete,
  onClose,
}: {
  frame: RvFrame
  reservationId: string
  /** The night may be written at all (not passed, not closed). */
  writable: boolean
  busy: boolean
  onEdit: (detail: RvDetailView) => void
  onCopy: (detail: RvDetailView) => void
  onNoShow: (reservationId: string) => void
  /** Calls the booking off; the sheet reads it again when it worked. */
  onCancel: (reservationId: string, party: PartyName, done: () => void) => void
  /** Takes the booking out of the book; the sheet closes when it worked. */
  onDelete: (reservationId: string, party: PartyName, done: () => void) => void
  onClose: () => void
}) {
  const t = useTranslations('reservations')
  const isMobile = useIsMobile()
  const dateText = useDateText()
  const guests = useGuestsText()
  // undefined while loading; null when the reservation is not this venue's any more.
  const [detail, setDetail] = useState<RvDetailView | null | undefined>(undefined)
  // The read never got an answer (no connection): a retry line, not a sheet that loads for ever.
  const [failed, setFailed] = useState(false)
  // Who changed the reservation while this sheet was open, once that has happened.
  const [changedBy, setChangedBy] = useState<WhoView | null>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  // The newest history line the sheet has shown, which is how a change is noticed.
  const seen = useRef<number | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    void readAttempt(() => reservationDetailAction({ venueId: frame.venueId, reservationId })).then(
      (result) => {
        if (result === READ_FAILED) {
          setFailed(true)
          return
        }
        const fresh = result.ok ? result.detail : null
        setDetail(fresh)
        const newest = fresh?.history.at(-1)
        if (newest !== undefined) {
          if (seen.current !== null && newest.seq > seen.current) setChangedBy(newest.by)
          seen.current = newest.seq
        }
      },
    )
  }, [frame.venueId, reservationId])
  useEffect(() => load(), [load])

  // Kept current while it is open, as the list behind it is: the sheet is read, never saved, so
  // the fresh version simply replaces what was there and the notice says it changed.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, FEED_POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const title = detail ? (detail.row.name ?? t('no_name')) : failed ? t('sh_fail_t') : t('loading')
  const sub = detail
    ? [dateText(detail.day), detail.row.time, guests(detail.row.partySize)]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : ''
  // What this person may do with this booking, drawn or not (a role that may not is told who may).
  const status = detail?.row.status
  const ended = status !== undefined && (ENDED as readonly string[]).includes(status)
  const mayManage = frame.can.manage || frame.device
  const isBlock = detail?.row.kind === 'block'
  const mayEdit = detail !== undefined && detail !== null && writable && mayManage && !ended
  const mayCancel =
    detail !== undefined &&
    detail !== null &&
    writable &&
    mayManage &&
    (status === 'reserved' || status === 'waiting' || status === 'requested')
  const mayDelete =
    detail !== undefined && detail !== null && writable && !isBlock && (mayManage || detail.mine)
  const mayCopy = detail?.row.kind === 'booking' && frame.can.tonight
  const mayNoShow = writable && frame.can.tonight && status === 'reserved'
  const party: PartyName = detail?.row.name ?? t('no_name')
  const body = detail ? (
    <Body detail={detail} changedBy={changedBy} sayWhoManages={writable && !mayManage && !ended} />
  ) : failed ? (
    <ReadFailed onRetry={load} />
  ) : detail === null ? (
    <p className="px-4 text-sm text-muted-foreground" data-testid="rv-sheet-gone">
      {t('sh_gone')}
    </p>
  ) : null
  const buttons = (
    <>
      {mayEdit && detail ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-edit"
          onClick={() => onEdit(detail)}
        >
          {t('bk_edit')}
        </Button>
      ) : null}
      {detail?.phone ? (
        <Button
          asChild
          variant={mayEdit ? 'outline' : 'default'}
          className={WRAPS}
          data-testid="rv-call"
        >
          <a href={`tel:${detail.phone}`}>
            <PhoneIcon aria-hidden />
            {t('call')}
          </a>
        </Button>
      ) : null}
      {mayCancel ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-cancel"
          onClick={() => setConfirm('cancel')}
        >
          {t('bk_cancel')}
        </Button>
      ) : null}
      {detail && (mayCopy || mayNoShow || mayDelete) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={WRAPS}
              data-testid="rv-more"
              aria-label={t('bk_more')}
            >
              <EllipsisIcon aria-hidden />
              {t('bk_more')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {mayCopy ? (
              <DropdownMenuItem
                className="min-h-11"
                data-testid="rv-copy-open"
                onSelect={() => onCopy(detail)}
              >
                {t('bk_copy')}
              </DropdownMenuItem>
            ) : null}
            {mayNoShow ? (
              <DropdownMenuItem
                className="min-h-11"
                data-testid="rv-noshow"
                onSelect={() => onNoShow(detail.row.id)}
              >
                {t('bk_noshow')}
              </DropdownMenuItem>
            ) : null}
            {mayDelete ? (
              <DropdownMenuItem
                className="min-h-11"
                data-testid="rv-delete"
                onSelect={() => setConfirm('delete')}
              >
                {t('bk_delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="h-12"
        data-testid="rv-close"
        onClick={onClose}
      >
        {t('close')}
      </Button>
    </>
  )

  const confirmation =
    confirm === null || detail === null || detail === undefined ? null : confirm === 'cancel' ? (
      <ConfirmDialog
        testId="rv-cancel-dialog"
        title={t('bk_cancel_t', { party })}
        body={t('bk_cancel_b')}
        doLabel={t('bk_cancel')}
        keepLabel={t('bk_keep')}
        busy={busy}
        onKeep={() => setConfirm(null)}
        onDo={() =>
          onCancel(detail.row.id, party, () => {
            setConfirm(null)
            load()
          })
        }
      />
    ) : (
      <ConfirmDialog
        testId="rv-delete-dialog"
        title={t('bk_delete_t', { party })}
        body={t('bk_delete_b')}
        doLabel={t('bk_delete_do')}
        keepLabel={t('bk_keep')}
        busy={busy}
        onKeep={() => setConfirm(null)}
        onDo={() =>
          onDelete(detail.row.id, party, () => {
            setConfirm(null)
            onClose()
          })
        }
      />
    )

  return (
    <>
      {isMobile ? (
        <Drawer open onOpenChange={(open) => !open && onClose()}>
          <DrawerContent data-testid="rv-sheet" aria-busy={detail === undefined}>
            <DrawerHeader>
              <DrawerTitle className="[overflow-wrap:anywhere]">{title}</DrawerTitle>
              <DrawerDescription>{sub}</DrawerDescription>
            </DrawerHeader>
            {body}
            <DrawerFooter>{buttons}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
          <SheetContent data-testid="rv-sheet" aria-busy={detail === undefined}>
            <SheetHeader>
              <SheetTitle className="[overflow-wrap:anywhere]">{title}</SheetTitle>
              <SheetDescription>{sub}</SheetDescription>
            </SheetHeader>
            {body}
            <SheetFooter>{buttons}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      {confirmation}
    </>
  )
}
