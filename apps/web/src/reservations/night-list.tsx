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
// It only reads. Taking, changing and seating a reservation are their own tickets, and each goes
// through `applyService` (rule 1), never around it.
import { CalendarPlusIcon, CircleAlertIcon, LockIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { WRAPS } from '@/lib/wrapping'
import { reservationNightAction } from '@/server/reservations/actions'
import type { RvFrame, RvNightView } from '@/server/reservations/view'
import { DayPicker, useDateText } from '@/tonight/day-picker'
import { useLiveFeed } from '@/tonight/live-feed'
import { FailedBlock, NewLine, NothingHere, RowsSkeleton } from '@/tonight/tab-parts'

import {
  filterCount,
  filterRows,
  RESERVATION_FILTERS,
  type ReservationFilter,
} from './night-filters'
import { ReservationRow } from './reservation-row'
import { ReservationSheet } from './reservation-sheet'
import { useFilterWord } from './reservation-words'

/** How many nights the night button lists ahead; the date field reaches any other one. */
const NIGHTS_AHEAD = 60

/**
 * The one filled button on the screen. Its form is the booking screen's (#328), which wires this
 * button to it; until then it is plainly not ready rather than a button that does nothing.
 */
function NewButton() {
  const t = useTranslations('reservations')
  return (
    <Button type="button" className={WRAPS} disabled data-testid="rv-new">
      <CalendarPlusIcon aria-hidden />
      {t('new')}
    </Button>
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
  const dateText = useDateText()
  const [day, setDay] = useState(initial.day)
  const [filter, setFilter] = useState<ReservationFilter>('all')
  const [open, setOpen] = useState<string | null>(null)

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
  // The chosen night is still being read: the night on screen is another one, so it is not shown.
  const reading = night.day !== day
  const rows = useMemo(() => filterRows(night.rows, filter), [night.rows, filter])
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
    if (night.rows.length === 0) {
      return <NothingHere text={t('empty')} action={frame.can.manage ? <NewButton /> : undefined} />
    }
    if (rows.length === 0) return <NothingHere text={t('empty_filter')} />
    return (
      <ul className="divide-y rounded-lg border" data-testid="rv-list">
        {rows.map((row) => (
          <ReservationRow key={row.id} row={row} onOpen={() => setOpen(row.id)} />
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
        {frame.can.manage ? <NewButton /> : null}
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
      {open === null ? null : (
        <ReservationSheet frame={frame} reservationId={open} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
