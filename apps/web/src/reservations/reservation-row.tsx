'use client'

// One reservation on a row (#326; Patterns: "A list of records"). Everything the night needs at a
// glance and nothing more: the hour, the name, the party, the spots and the state. No colour
// carries a state by itself — the state is a word, and "Late" is a word on a tint, explained once
// under the filters. One tap on the row opens the whole reservation.
//
// The row carries one action of the door (#329): "Arrived" for a party that is coming — the
// hostess's commonest tap of the night, and the reason the row has a button at all. What is under
// "…" beside it is everything that is not that tap (Patterns: the secondary actions of a row):
// marking a party that never came, and freeing a party that has gone — freeing is the end of a
// night and not its default, so it is never the row's button.
//
// A party on the waiting list has its own one action (#330): "Give a spot", which seats it in the
// same move, so there is no "Arrived" to tap afterwards. Under the "Waiting" filter the same row
// also carries what a queue needs — how long the party has waited, and its number as a link to
// ring, because calling the next one by hand is the whole of what the list is for (D137).
//
// On a phone the row stacks (the screen round's S16, WCAG 1.4.10): the hour, the name and the party
// on the first line with "…" in its corner, the state on the second, and the row's action full width
// under them, so a name is never squeezed to a letter a line. From 768 px it is one line again, the
// action and "…" at its end, with the "…" slot kept on every row so the buttons line up.
import { ChevronRightIcon, EllipsisIcon, PhoneIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RvRowView } from '@/server/reservations/view'

import { useByClubWord, useGuestsText, useSpotsText, useStatusWord } from './reservation-words'

/**
 * The states "Arrived" is offered on: a booking that is coming. A waiting party is not one of them
 * (#330) — it has no spot to be marked present on, and "Give a spot" seats it in the same move.
 */
const COMING: ReadonlySet<string> = new Set(['reserved'])

/** The row's own buttons: full width under the row on a phone, their words wrap rather than clip. */
const ROW_BUTTON = 'h-auto min-h-11 max-w-full flex-1 whitespace-normal md:flex-none'

export function ReservationRow({
  row,
  onOpen,
  onNoShow,
  onArrive,
  onGive,
  onFree,
  waited,
  phone,
  busy,
}: {
  row: RvRowView
  onOpen: () => void
  /** Marks the party as a no-show; absent where this night or this role cannot. */
  onNoShow: (() => void) | null
  /** The guests are here: one tap, and their table codes open (#329). */
  onArrive: (() => void) | null
  /**
   * Gives a waiting party a spot, which seats it in the same move (#330). The row's own button
   * where the party is waiting; absent where this night or this role cannot seat.
   */
  onGive?: (() => void) | null
  /** They have gone: the spots go back and the codes close. Under "…", never the button. */
  onFree: (() => void) | null
  /** "Waiting for 25 min", on the queue's own filter; left out everywhere else (#330). */
  waited?: string | null
  /** The number to ring, under the "Waiting" filter only: a queue is a list of whom to call. */
  phone?: string | null
  busy: boolean
}) {
  const t = useTranslations('reservations')
  const word = useStatusWord()
  const guests = useGuestsText()
  const spotsText = useSpotsText()
  const byClub = useByClubWord()
  // What is under "…": one line each, in the order a night needs them.
  const more = [
    onNoShow === null || row.status !== 'reserved'
      ? null
      : { testId: 'rv-row-noshow', label: t('bk_noshow'), act: onNoShow },
    onFree === null || row.status !== 'seated' || row.spots.length === 0
      ? null
      : { testId: 'rv-row-free', label: t('d_free'), act: onFree },
  ].filter((item): item is { testId: string; label: string; act: () => void } => item !== null)
  const parts = [
    guests(row.partySize),
    // «място 9», never a bare "9" beside the party size, which reads as a second count (S1).
    spotsText(row.spots),
    // A waiting party is a walk-in in the data (D137), and so is a booking saved with no spot: the
    // state already says it is waiting, so the kind would only read as a contradiction.
    row.kind === 'walk_in' && row.status !== 'waiting' ? t('walk_in') : null,
    waited ?? null,
  ].filter((part): part is string => part !== null && part !== '')
  // The hour column means "expected at" on every other row. A waiting party was never expected: its
  // hour is when it was written down, so it says so — «от 15:09» (R2).
  const time =
    row.status === 'waiting' && row.time !== '' ? t('w_since', { time: row.time }) : row.time
  const call = phone === null || phone === undefined || phone === '' ? null : phone
  const give = onGive === null || onGive === undefined || row.status !== 'waiting' ? null : onGive
  const arrive = onArrive === null || !COMING.has(row.status) ? null : onArrive
  const name = row.name ?? t('no_name')

  return (
    <li
      className="flex flex-wrap items-start md:flex-nowrap md:items-stretch"
      data-testid="rv-row"
      data-status={row.status}
      data-late={row.late ? 'yes' : 'no'}
    >
      <button
        type="button"
        className="grid min-h-11 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
        onClick={onOpen}
        data-testid="rv-row-open"
      >
        <span
          className="col-start-1 row-start-1 min-w-11 whitespace-nowrap pt-0.5 text-sm tabular-nums text-muted-foreground"
          data-testid="rv-row-time"
        >
          {time}
        </span>
        <span className="col-start-2 row-start-1 min-w-0 space-y-0.5">
          <span className="block font-medium break-words" data-testid="rv-row-name">
            {name}
          </span>
          {parts.length === 0 ? null : (
            <span className="block text-sm text-muted-foreground break-words">
              {parts.join(' · ')}
            </span>
          )}
        </span>
        <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-1 md:col-start-3 md:row-start-1 md:flex-col md:flex-nowrap md:items-end md:text-right">
          <Badge variant="outline">{word(row.status)}</Badge>
          {/* Called off by the club, not by the guest: one word beside the state, never hidden. */}
          {byClub(row) === null ? null : (
            <span className="text-xs text-muted-foreground" data-testid="rv-by-club">
              {byClub(row)}
            </span>
          )}
          {row.late ? (
            <Badge variant="danger" data-testid="rv-late">
              {t('s_late')}
            </Badge>
          ) : null}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="col-start-3 row-start-1 mt-1 size-4 shrink-0 text-muted-foreground md:col-start-4"
        />
      </button>
      {call === null && give === null && arrive === null ? null : (
        <span
          className="order-last flex w-full flex-wrap gap-2 px-3 pb-3 md:order-none md:w-auto md:shrink-0 md:flex-nowrap md:items-center md:p-2 md:pl-0"
          data-testid="rv-row-actions"
        >
          {call === null ? null : (
            <Button asChild variant="ghost" className={ROW_BUTTON} data-testid="rv-row-call">
              <a href={`tel:${call}`} aria-label={`${t('call')} ${call}`}>
                <PhoneIcon aria-hidden />
                <span className="tabular-nums">{call}</span>
              </a>
            </Button>
          )}
          {give === null ? null : (
            <Button
              type="button"
              className={ROW_BUTTON}
              disabled={busy}
              data-testid="rv-row-give"
              onClick={give}
            >
              {t('w_give')}
            </Button>
          )}
          {arrive === null ? null : (
            <Button
              type="button"
              className={ROW_BUTTON}
              disabled={busy}
              data-testid="rv-row-arrive"
              onClick={arrive}
            >
              {t('d_arrived')}
            </Button>
          )}
        </span>
      )}
      {more.length === 0 ? (
        // The slot stays on a wide screen, so the row's button sits in the same column on every
        // row; on a phone the button is under the row and there is nothing to line up.
        <span aria-hidden className="hidden size-11 shrink-0 md:block" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 self-start"
              aria-label={t('bk_row_more', { party: name })}
              data-testid="rv-row-more"
            >
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map((item) => (
              <DropdownMenuItem
                key={item.testId}
                className="min-h-11"
                data-testid={item.testId}
                onSelect={item.act}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
