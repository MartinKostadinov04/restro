'use client'

// Venue › Reservations, the night's list (#326; D135, D138, D141). Tonight's reservations in
// arrival order the moment the screen opens, each row readable without opening anything. The
// filters are one tap each and carry their count, so nobody counts rows himself; a filter with
// nothing behind it is not drawn. Another night is the night button of Tonight's Log, extended
// here to the nights still to come.
//
// The night shown is this screen's own, not the page's `day` parameter: Reservations opens on
// today every time it is entered, so nobody works the wrong night by accident, and Tonight's own
// chosen night never follows a tab switch in here.
//
// A night that has passed says so in one banner and is read-only, unless the club allows
// corrections and this role may make them. A read that does not get through keeps the list that is
// already on screen and says so in a notice that stays (RR-O47), because an empty list would read
// as an empty night.
//
// The waiting list is here too and nowhere else (#330; D137): it is this same list under its
// "Waiting" filter, in the queue's own order — oldest first, said in one line, because every other
// filter reads the other way round — with how long each party has waited and its number to ring.
// "Give a spot" on a waiting row opens the plan for one tap, and that tap seats the party through
// the arrival path of #329. "Add a party" is the list's own door and the only way onto it by hand —
// a booking with no spot yet is a booking (#328), never a waiting line. Cancelling and taking one
// out are the ordinary operations of its sheet: the queue adds no workflow of its own.
//
// Taking and changing a booking is here (#328): the "New reservation" button opens the booking form,
// a row's sheet changes, calls off, copies or takes out a booking, and the night's bin brings a
// deleted one back. The door is here too (#329): "Arrived" on a row of a party that is coming, and
// "Free" under its "…" once they are sitting. Every write goes through `applyService` (rule 1),
// never around it, and a refusal is the toast that stays.
import {
  CalendarPlusIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  LockIcon,
  UserPlusIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { WRAPS } from '@/lib/wrapping'
import { addWaitingAction, reservationNightAction } from '@/server/reservations/actions'
import type { RvDetailView, RvFrame, RvNightView, RvRowView } from '@/server/reservations/view'
import { useDuration } from '@/settings/use-duration'
import { DayPicker, useDateText } from '@/tonight/day-picker'
import { useLiveFeed } from '@/tonight/live-feed'
import { FailedBlock, NewLine, NothingHere, RowsSkeleton } from '@/tonight/tab-parts'
import { useBookingActions } from './booking-actions'
import { BookingForm, type BookingMode } from './booking-form'
import { type ChangeTablesParty, ChangeTablesSheet } from './change-tables'
import { CopyDialog } from './copy-dialog'
import { useDoorActions } from './door-actions'
import { GuestsDialog } from './door-dialogs'
import { GiveSpotDialog } from './give-spot'
import {
  filterCount,
  filterRows,
  RESERVATION_FILTERS,
  type ReservationFilter,
  waitingQueue,
} from './night-filters'
import { ReservationRow } from './reservation-row'
import { ReservationSheet } from './reservation-sheet'
import { useFilterWord, useGuestsText } from './reservation-words'
import { useReservationRun } from './use-reservation-run'
import { type WaitingDraft, WaitingForm } from './waiting-form'

/** How many nights the night button lists ahead; the date field reaches any other one. */
const NIGHTS_AHEAD = 60

/**
 * The one filled button on the screen: it opens the booking form (#328). Not drawn on a night that
 * cannot be written, nor for a role that does not work tonight's reservations; on a shared device
 * it is there and the PIN sheet comes with Save.
 */
function NewButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('reservations')
  return (
    <Button type="button" className={WRAPS} data-testid="rv-new" onClick={onClick}>
      <CalendarPlusIcon aria-hidden />
      {t('new')}
    </Button>
  )
}

/**
 * The waiting list's own door (#330): it writes a party onto the queue, and it is the only way onto
 * the list by hand. A booking is never taken here — a party with no spot is not a booking with
 * nowhere to sit — so it is the outline button beside "New reservation", never a second filled one.
 */
function AddPartyButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('reservations')
  return (
    <Button
      type="button"
      variant="outline"
      className={WRAPS}
      data-testid="rv-wl-add"
      onClick={onClick}
    >
      <UserPlusIcon aria-hidden />
      {t('w_add')}
    </Button>
  )
}

/** The night's bin: lines taken out of the book, which a manager brings back (D135). */
function Bin({
  rows,
  onRestore,
}: {
  rows: readonly RvRowView[]
  onRestore: (row: RvRowView) => void
}) {
  const t = useTranslations('reservations')
  const guests = useGuestsText()
  return (
    <Collapsible className="rounded-lg border" data-testid="rv-bin">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full justify-between"
          data-testid="rv-bin-open"
        >
          {t('bk_bin', { k: rows.length })}
          <ChevronDownIcon aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 p-3" data-testid="rv-bin-row">
              <span className="w-11 shrink-0 text-sm tabular-nums text-muted-foreground">
                {row.time}
              </span>
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                <span className="block font-medium">{row.name ?? t('no_name')}</span>
                <span className="block text-muted-foreground">{guests(row.partySize)}</span>
              </span>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                data-testid="rv-restore"
                onClick={() => onRestore(row)}
              >
                {t('bk_restore')}
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The one banner that says what the whole night is (Patterns: "A state of the whole page"). */
function Banner({ night, frame }: { night: RvNightView; frame: RvFrame }) {
  const t = useTranslations('reservations')
  const kind = night.closed
    ? 'closed'
    : night.settingsMissing
      ? 'settings'
      : !night.passed
        ? null
        : night.refusal === null
          ? 'open'
          : 'passed'
  if (kind === null) return null
  const text =
    kind === 'closed'
      ? t('b_closed')
      : kind === 'settings'
        ? t('b_settings')
        : kind === 'open'
          ? t('b_passed_open')
          : // The club allows corrections but this role may not make them: say which it is.
            frame.editPastNights
            ? t('b_passed_denied')
            : t('b_passed')
  const Icon = kind === 'settings' ? CircleAlertIcon : LockIcon
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border bg-info/10 p-4"
      data-testid="rv-banner"
      data-kind={kind}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-base [overflow-wrap:anywhere]">{text}</p>
    </div>
  )
}

/** The night's list. `initial` is always the venue's own tonight, as the server read it. */
export function NightList({ initial, frame }: { initial: RvNightView; frame: RvFrame }) {
  const t = useTranslations('reservations')
  const word = useFilterWord()
  const duration = useDuration()
  const dateText = useDateText()
  const [day, setDay] = useState(initial.day)
  const [filter, setFilter] = useState<ReservationFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState<BookingMode | null>(null)
  const [copying, setCopying] = useState<RvDetailView | null>(null)
  const [counting, setCounting] = useState<RvDetailView | null>(null)
  /** The party whose tables are being changed (#331), over the list. */
  const [moving, setMoving] = useState<ChangeTablesParty | null>(null)
  // The waiting party whose spot is being chosen (#330), by its reservation.
  const [giving, setGiving] = useState<string | null>(null)
  /** The waiting list's own form is open: a party is being written down (#330). */
  const [adding, setAdding] = useState(false)
  const { run, busy, pinSheet } = useReservationRun({ device: frame.device })

  const feed = useLiveFeed<RvNightView>({
    initial,
    query: [day],
    // Only tonight moves: a night that is over, and one still to come, stand still.
    live: day === frame.today,
    keysOf: (view) => view.rows.map((row) => row.id),
    refresh: (shown, latest) => ({
      ...latest,
      rows: shown.rows.map((row) => latest.rows.find((fresh) => fresh.id === row.id) ?? row),
    }),
    load: async () => {
      const result = await reservationNightAction({ venueId: frame.venueId, day })
      return result.ok ? result.night : null
    },
  })
  const night = feed.shown
  const { reload } = feed
  const actions = useBookingActions({ frame, run, onChanged: reload })
  const door = useDoorActions({ frame, run, onChanged: reload })
  /** This night may be written, and by this role: the booking controls are drawn. */
  const writable = night.refusal === null
  const mayTake = frame.can.tonight && writable
  // The chosen night is still being read: the night on screen is another one, so it is not shown.
  const reading = night.day !== day
  const rows = useMemo(() => filterRows(night.rows, filter), [night.rows, filter])
  /** The queue of this night, oldest first: what the "Waiting" filter draws (#330). */
  const queue = useMemo(() => waitingQueue(night.rows, night.waiting), [night.rows, night.waiting])
  /**
   * How long a party has waited, in words — on tonight only. A party written down for a night still
   * to come has waited since she wrote it down, which says nothing about that night, so its row
   * carries the hour it was taken instead of a number that would read as a very long wait.
   */
  const waitedText = (minutes: number) => (night.today ? duration(minutes) : null)
  /** The same wait as the row says it: "Waiting for 20 min", or nothing on another night. */
  const waitedLine = (minutes: number) => {
    const waited = waitedText(minutes)
    return waited === null ? null : t('w_for', { duration: waited })
  }
  /**
   * A party written down on the list: `waiting.add` for the night shown, the one path that writes a
   * waiting line and its place in the queue. No hour and no spot — having neither is what the list
   * is — and the toast names her, because that is what she wants read back.
   */
  const addParty = (draft: WaitingDraft) => {
    const party = draft.name === '' ? t('no_name') : draft.name
    setAdding(false)
    run({
      id: 'rv-waiting-add',
      done: t('w_added', { party }),
      pin: { title: t('w_add'), body: t('bk_pin_b') },
      act: (pin) =>
        addWaitingAction({
          venueId: frame.venueId,
          day,
          partySize: draft.partySize,
          name: draft.name === '' ? null : draft.name,
          phone: draft.phone === '' ? null : draft.phone,
          note: draft.note === '' ? null : draft.note,
          reason: draft.reason,
          ...(pin === undefined ? {} : { pin }),
        }),
      after: reload,
      // She is looking at the queue she just joined, so the list she lands on is that one.
      onDone: () => setFilter('waiting'),
    })
  }
  const givingLine = giving === null ? null : (queue.find((one) => one.row.id === giving) ?? null)
  /** The spot she tapped, for the party she opened: seated there, by #329's one path. */
  const give = (spot: { readonly id: string; readonly name: string }) => {
    if (givingLine === null) return
    setGiving(null)
    door.arrive({
      reservationId: givingLine.row.id,
      day,
      name: givingLine.row.name,
      spotIds: [spot.id],
      onSpot: spot.name,
    })
  }
  // A filter with nothing behind it does no job, so it is not drawn (D123 rule 2).
  const chips = RESERVATION_FILTERS.filter(
    (value) => value === 'all' || filterCount(night.counts, value) > 0,
  )

  // A failed read keeps the list and says so in a notice that stays until the next read gets
  // through, rather than taking the night off the screen.
  const failedWithRows = feed.failed && night.rows.length > 0 && !reading
  useEffect(() => {
    if (!failedWithRows) return
    const id = toast.error(t('fail'), { duration: Number.POSITIVE_INFINITY })
    return () => {
      toast.dismiss(id)
    }
  }, [failedWithRows, t])

  const body = (() => {
    if (reading || (night.rows.length === 0 && feed.loading)) return <RowsSkeleton />
    if (feed.failed && night.rows.length === 0) return <FailedBlock text={t('fail')} />
    // The queue is this list under its own filter, in its own order: the same rows, never a second
    // list (#330, D137). Nobody waiting is the empty-state block, which invites the first.
    if (filter === 'waiting') {
      if (queue.length === 0) {
        return (
          <NothingHere
            text={t('w_empty')}
            action={mayTake ? <AddPartyButton onClick={() => setAdding(true)} /> : undefined}
          />
        )
      }
      return (
        <ul className="divide-y rounded-lg border" data-testid="rv-list">
          {queue.map(({ row, party }) => (
            <ReservationRow
              key={row.id}
              row={row}
              busy={busy || door.reading}
              waited={waitedLine(party.waitedMinutes)}
              phone={party.phone}
              onOpen={() => setOpen(row.id)}
              onNoShow={null}
              onArrive={null}
              onGive={mayTake ? () => setGiving(row.id) : null}
              onFree={null}
            />
          ))}
        </ul>
      )
    }
    if (night.rows.length === 0) {
      return (
        <NothingHere
          text={t('empty')}
          action={mayTake ? <NewButton onClick={() => setForm({ kind: 'new', day })} /> : undefined}
        />
      )
    }
    if (rows.length === 0) return <NothingHere text={t('empty_filter')} />
    return (
      <ul className="divide-y rounded-lg border" data-testid="rv-list">
        {rows.map((row) => (
          <ReservationRow
            key={row.id}
            row={row}
            busy={busy || door.reading}
            onOpen={() => setOpen(row.id)}
            onNoShow={writable && frame.can.tonight ? () => actions.noShow(row.id) : null}
            onArrive={
              mayTake
                ? () =>
                    door.arrive({
                      reservationId: row.id,
                      day,
                      name: row.name,
                      // No spots of its own: the party is marked present on the ones it holds.
                      spotIds: [],
                    })
                : null
            }
            onGive={mayTake ? () => setGiving(row.id) : null}
            onFree={
              mayTake
                ? () => door.free({ reservationId: row.id, day, name: row.name, spotIds: [] })
                : null
            }
          />
        ))}
      </ul>
    )
  })()

  return (
    <div className="space-y-4" data-testid="reservations-night">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('title')}
          <span className="ml-2 text-base font-normal text-muted-foreground">
            {day === frame.today ? t('tab_list') : dateText(day)}
          </span>
        </h2>
        {mayTake ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            {/* The two ways a party enters the night: a booking, or a party with no spot. The
                queue's own filter is only drawn once somebody waits, so the list's door cannot
                live behind it — it is here, except on the empty queue, whose one line carries it
                instead, so the screen never offers the same thing twice. */}
            {filter === 'waiting' && queue.length === 0 ? null : (
              <AddPartyButton onClick={() => setAdding(true)} />
            )}
            <NewButton onClick={() => setForm({ kind: 'new', day })} />
          </div>
        ) : null}
      </div>
      {reading ? null : <Banner night={night} frame={frame} />}
      <DayPicker
        day={day}
        today={frame.today}
        days={night.days}
        ahead={NIGHTS_AHEAD}
        label={t('tab_list')}
        anyDate
        onPick={setDay}
      />
      {reading ? null : (
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">{t('filters')}</legend>
          {chips.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? 'default' : 'outline'}
              aria-pressed={filter === value}
              className="min-h-11"
              data-testid={`rv-filter-${value}`}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? t('f_all') : value === 'late' ? t('f_late') : word(value)}
              <span className="tabular-nums">{filterCount(night.counts, value)}</span>
            </Button>
          ))}
        </fieldset>
      )}
      {!reading && filter === 'waiting' && queue.length > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="rv-waiting-note">
          {t('w_order')}
        </p>
      ) : null}
      {!reading && night.counts.late > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="rv-late-note">
          {t('late_note')}
        </p>
      ) : null}
      <div aria-busy={feed.loading} className="space-y-2">
        <NewLine k={feed.fresh} onShow={feed.show} />
        {body}
        {night.hasMore && !reading ? (
          <p className="text-sm text-muted-foreground" data-testid="rv-more">
            {t('more', { k: night.rows.length })}
          </p>
        ) : null}
      </div>
      {night.deleted.length > 0 && !reading && (frame.can.manage || frame.device) ? (
        <Bin
          rows={night.deleted}
          onRestore={(row) => actions.restore(row.id, row.name ?? t('no_name'))}
        />
      ) : null}
      {open === null ||
      form !== null ||
      copying !== null ||
      counting !== null ||
      moving !== null ? null : (
        <ReservationSheet
          frame={frame}
          reservationId={open}
          writable={writable}
          busy={busy}
          onEdit={(detail) => {
            setOpen(null)
            setForm({ kind: 'edit', detail })
          }}
          onCopy={(detail) => setCopying(detail)}
          onNoShow={actions.noShow}
          onCancel={actions.cancel}
          onDelete={actions.remove}
          onArrive={
            mayTake
              ? (detail) =>
                  door.arrive({
                    reservationId: detail.row.id,
                    day,
                    name: detail.row.name,
                    spotIds: detail.spotIds,
                  })
              : null
          }
          onGuests={mayTake ? (detail) => setCounting(detail) : null}
          onPayRule={actions.payRule}
          onChangeTables={
            mayTake
              ? (detail) => setMoving({ reservationId: detail.row.id, name: detail.row.name, day })
              : null
          }
          onFree={
            mayTake
              ? (detail) =>
                  door.free({
                    reservationId: detail.row.id,
                    day,
                    name: detail.row.name,
                    spotIds: [],
                  })
              : null
          }
          onClose={() => setOpen(null)}
        />
      )}
      {form === null ? null : (
        <BookingForm
          frame={frame}
          mode={form}
          run={run}
          busy={busy}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            reload()
          }}
        />
      )}
      {copying === null ? null : (
        <CopyDialog
          frame={frame}
          detail={copying}
          run={run}
          busy={busy}
          onClose={() => setCopying(null)}
          onCopied={() => {
            setCopying(null)
            setOpen(null)
            reload()
          }}
        />
      )}
      {moving === null ? null : (
        <ChangeTablesSheet
          frame={frame}
          party={moving}
          run={run}
          onClose={() => setMoving(null)}
          onChanged={reload}
        />
      )}
      {counting === null ? null : (
        <GuestsDialog
          party={counting.row.name ?? t('no_name')}
          partySize={counting.row.partySize}
          busy={busy}
          onLeave={() => setCounting(null)}
          onSave={(guests) =>
            door.setGuests(counting.row.id, counting.row.name ?? t('no_name'), guests, () =>
              setCounting(null),
            )
          }
        />
      )}
      {givingLine === null ? null : (
        <GiveSpotDialog
          frame={frame}
          day={day}
          party={givingLine.party}
          waited={waitedText(givingLine.party.waitedMinutes)}
          busy={busy || door.reading}
          onGive={give}
          onClose={() => setGiving(null)}
        />
      )}
      {adding ? (
        <WaitingForm busy={busy} onSave={addParty} onClose={() => setAdding(false)} />
      ) : null}
      {door.node}
      {pinSheet}
    </div>
  )
}
