'use client'

import type { PayRule } from '@restro/core'
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
// The door is here as well (#329): "Arrived" for a party that is still coming, and, once it is
// sitting, "Guests" for the count — the one place it is asked, after they are seated and never at
// the door — with "Free" under "…" beside the rest.
//
// Calling the guest is one tap here and nowhere else: the number is read for this sheet alone and
// never travels with the night's list. Closing loses nothing.
//
// A booking with a guest record links to his card on Guests (#333), under "…".
//
// The Pay rule section is here as well (#334, D135): three cards — the club's rule, everything on
// the bill, pay first — one of which is always the one in force, so an empty rule reads "The club's
// rule" and never as a blank. A tap writes at once with Undo on the toast; where a table of theirs
// carries a pay-first setting of its own, one line says so, because that setting wins over the
// party's (D122 §5). A role without `reservations.pay_rule` reads the rule as text and one line
// saying who may; on a shared device the cards are there and the PIN sheet names the person (D141).
import { EllipsisIcon, PhoneIcon } from 'lucide-react'
import Link from 'next/link'
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

import type { PartyName, PayRuleChange } from './booking-actions'
import { ConfirmDialog } from './confirm-dialog'
import {
  useByClubWord,
  useGuestsText,
  useHistoryText,
  usePayRuleWord,
  useStatusWord,
} from './reservation-words'

/** One labelled line of the sheet; nothing is drawn where there is nothing to say. */
function Line({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null
  return (
    <p className="[overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{label}</span> {value}
    </p>
  )
}

/**
 * The three rules a party can be on, widest first: the club's own rule (no rule of its own), then
 * the two it can carry. One of them is always in force, so the section can never read as blank.
 */
const PAY_RULE_CHOICES: readonly { readonly key: string; readonly rule: PayRule | null }[] = [
  { key: 'venue', rule: null },
  { key: 'on_bill', rule: 'on_bill' },
  { key: 'pay_first', rule: 'pay_first' },
]

/**
 * The Pay rule section (#334): which rule this party carries, for this sitting. The card shows the
 * choice at once and the sheet reads again when the write settles, so a refusal snaps the choice
 * back to what the server holds rather than leaving a guess on screen.
 */
function PayRuleSection({
  detail,
  frame,
  busy,
  onPayRule,
  onSettled,
}: {
  detail: RvDetailView
  frame: RvFrame
  busy: boolean
  onPayRule: (change: PayRuleChange) => void
  onSettled: () => void
}) {
  const t = useTranslations('reservations')
  const word = usePayRuleWord()
  // On a shared device the cards are drawn and the PIN sheet names the person: a hostess is never
  // shown a dead control (D141, #324).
  const may = frame.can.payRule || frame.device
  const saved = detail.payRule.rule
  // The choice the person just made, until the write settles and the sheet has the server's own.
  // It remembers what was saved when it was made, so a rule that changes under the sheet — this
  // write landing, an Undo, somebody else's change arriving with the next read — drops the guess
  // without an effect having to reset it.
  const [picked, setPicked] = useState<{
    readonly against: PayRule | null
    readonly rule: PayRule | null
  } | null>(null)
  const shown = picked !== null && picked.against === saved ? picked.rule : saved
  const party: PartyName = detail.row.name ?? t('no_name')

  return (
    <section className="space-y-2" data-testid="rv-pay-rule">
      <h3 className="font-medium">{t('pr_title')}</h3>
      {may ? (
        <div
          role="radiogroup"
          aria-label={t('pr_title')}
          className="grid gap-2"
          data-testid="rv-pay-rule-choices"
        >
          {PAY_RULE_CHOICES.map((choice) => {
            const chosen = shown === choice.rule
            return (
              <label
                key={choice.key}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                  chosen ? 'border-primary bg-primary/5' : ''
                } ${busy ? 'cursor-default opacity-70' : ''}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`rv-pay-rule-${detail.row.id}`}
                  value={choice.key}
                  checked={chosen}
                  disabled={busy}
                  data-testid={`rv-pay-rule-${choice.key}`}
                  onChange={() => {
                    if (choice.rule === saved) return
                    setPicked({ against: saved, rule: choice.rule })
                    onPayRule({
                      reservationId: detail.row.id,
                      party,
                      rule: choice.rule,
                      previous: saved,
                      version: detail.version,
                      settled: () => {
                        setPicked(null)
                        onSettled()
                      },
                    })
                  }}
                />
                <span className="[overflow-wrap:anywhere]">{word(choice.rule)}</span>
              </label>
            )
          })}
        </div>
      ) : (
        <p data-testid="rv-pay-rule-value">{word(saved)}</p>
      )}
      <p className="text-muted-foreground">{t('pr_scope')}</p>
      {detail.payRule.beaten.map((one) => (
        <p
          key={one.spot}
          className="text-muted-foreground [overflow-wrap:anywhere]"
          data-testid="rv-pay-rule-beaten"
        >
          {t('pr_beaten', { spot: one.spot, rule: word(one.rule) })}
        </p>
      ))}
      {may ? null : (
        <p className="text-muted-foreground" data-testid="rv-pay-rule-cant">
          {t('pr_cant')}
        </p>
      )}
    </section>
  )
}

function Body({
  detail,
  frame,
  changedBy,
  sayWhoManages,
  busy,
  onPayRule,
  onSettled,
}: {
  detail: RvDetailView
  frame: RvFrame
  changedBy: WhoView | null
  /** This role may take a booking but not change one: one line says who may. */
  sayWhoManages: boolean
  busy: boolean
  onPayRule: (change: PayRuleChange) => void
  /** The pay rule's write settled: the sheet reads again. */
  onSettled: () => void
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
      {row.kind === 'block' ? null : (
        <PayRuleSection
          detail={detail}
          frame={frame}
          busy={busy}
          onPayRule={onPayRule}
          onSettled={onSettled}
        />
      )}
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
  onArrive,
  onGuests,
  onFree,
  onChangeTables,
  onPayRule,
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
  /** The guests are here (#329); absent where this night or this role cannot seat them. */
  onArrive: ((detail: RvDetailView) => void) | null
  /** Asks the count of a party already sitting. */
  onGuests: ((detail: RvDetailView) => void) | null
  /** They have gone: the spots go back and the table codes close. */
  onFree: ((detail: RvDetailView) => void) | null
  /** Change tables (#331): the party's spots on the plan, tapped on and off, and the swap. */
  onChangeTables: ((detail: RvDetailView) => void) | null
  /** The pay rule this party carries (#334); the write's own permission decides, not the screen. */
  onPayRule: (change: PayRuleChange) => void
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
  // The door: a party that is coming can be marked present; one that is sitting can be counted
  // and freed. A block is neither (#329).
  const mayArrive =
    detail != null &&
    !isBlock &&
    (status === 'reserved' || status === 'waiting') &&
    onArrive !== null
  const maySeated = detail != null && !isBlock && status === 'seated'
  const mayGuests = maySeated && onGuests !== null
  const mayFree = maySeated && onFree !== null
  // A party still coming or already sitting changes tables; a block, a waiting line (it has no
  // table yet: seating it is the door's) and an ended party do not (#331).
  const mayChangeTables =
    detail != null &&
    !isBlock &&
    writable &&
    (status === 'reserved' || status === 'requested' || status === 'seated') &&
    onChangeTables !== null
  const party: PartyName = detail?.row.name ?? t('no_name')
  const body = detail ? (
    <Body
      detail={detail}
      frame={frame}
      changedBy={changedBy}
      sayWhoManages={writable && !mayManage && !ended}
      busy={busy}
      onPayRule={onPayRule}
      onSettled={load}
    />
  ) : failed ? (
    <ReadFailed onRetry={load} />
  ) : detail === null ? (
    <p className="px-4 text-sm text-muted-foreground" data-testid="rv-sheet-gone">
      {t('sh_gone')}
    </p>
  ) : null
  const buttons = (
    <>
      {mayArrive && detail && onArrive ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-sheet-arrive"
          onClick={() => onArrive(detail)}
        >
          {t('d_arrived')}
        </Button>
      ) : null}
      {mayGuests && detail && onGuests ? (
        <Button
          type="button"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-sheet-guests"
          onClick={() => onGuests(detail)}
        >
          {t('d_guests')}
        </Button>
      ) : null}
      {mayEdit && detail ? (
        <Button
          type="button"
          variant={mayArrive || mayGuests ? 'outline' : 'default'}
          className={WRAPS}
          disabled={busy}
          data-testid="rv-edit"
          onClick={() => onEdit(detail)}
        >
          {t('bk_edit')}
        </Button>
      ) : null}
      {mayChangeTables && detail && onChangeTables ? (
        <Button
          type="button"
          variant="outline"
          className={WRAPS}
          disabled={busy}
          data-testid="rv-sheet-change-tables"
          onClick={() => onChangeTables(detail)}
        >
          {t('ct_open')}
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
      {detail && (mayCopy || mayNoShow || mayDelete || mayFree || detail.guestId !== null) ? (
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
            {detail.guestId === null ? null : (
              <DropdownMenuItem asChild className="min-h-11" data-testid="rv-guest-card">
                <Link href={`?tab=reservations&view=guests&guest=${detail.guestId}`}>
                  {t('g_card')}
                </Link>
              </DropdownMenuItem>
            )}
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
            {mayFree && onFree ? (
              <DropdownMenuItem
                className="min-h-11"
                data-testid="rv-sheet-free"
                onSelect={() => onFree(detail)}
              >
                {t('d_free')}
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
