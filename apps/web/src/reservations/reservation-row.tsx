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

import { useByClubWord, useGuestsText, useStatusWord } from './reservation-words'

/**
 * The states "Arrived" is offered on: a booking that is coming. A waiting party is not one of them
 * (#330) — it has no spot to be marked present on, and "Give a spot" seats it in the same move.
 */
const COMING: ReadonlySet<string> = new Set(['reserved'])

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
  const byClub = useByClubWord()
  // What is under "…": one line each, in the order a night needs them.
  const more = [
    onNoShow === null || row.status !== 'reserved'
      ? null
      : { testId: 'rv-row-noshow', label: t('bk_noshow'), act: onNoShow },
    onFree === null || row.status !== 'seated'
      ? null
      : { testId: 'rv-row-free', label: t('d_free'), act: onFree },
  ].filter((item): item is { testId: string; label: string; act: () => void } => item !== null)
  const parts = [
    guests(row.partySize),
    row.spots.length === 0 ? null : row.spots.join(', '),
    // A waiting party is a walk-in in the data (D137), and so is a booking saved with no spot: the
    // state already says it is waiting, so the kind would only read as a contradiction.
    row.kind === 'walk_in' && row.status !== 'waiting' ? t('walk_in') : null,
    waited ?? null,
  ].filter((part): part is string => part !== null && part !== '')

  return (
    <li
      className="flex items-stretch"
      data-testid="rv-row"
      data-status={row.status}
      data-late={row.late ? 'yes' : 'no'}
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      >
        <span className="w-11 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">
          {row.time}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block font-medium [overflow-wrap:anywhere]">
            {row.name ?? t('no_name')}
          </span>
          {parts.length === 0 ? null : (
            <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {parts.join(' · ')}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-right">
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
        <ChevronRightIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>
      {phone === null || phone === undefined || phone === '' ? null : (
        <span className="flex shrink-0 items-center p-2 pl-0">
          <Button asChild variant="ghost" className="min-h-11" data-testid="rv-row-call">
            <a href={`tel:${phone}`} aria-label={`${t('call')} ${phone}`}>
              <PhoneIcon aria-hidden />
              <span className="tabular-nums">{phone}</span>
            </a>
          </Button>
        </span>
      )}
      {onGive === null || onGive === undefined || row.status !== 'waiting' ? null : (
        <span className="flex shrink-0 items-center p-2 pl-0">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            data-testid="rv-row-give"
            onClick={onGive}
          >
            {t('w_give')}
          </Button>
        </span>
      )}
      {onArrive === null || !COMING.has(row.status) ? null : (
        <span className="flex shrink-0 items-center p-2 pl-0">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            data-testid="rv-row-arrive"
            onClick={onArrive}
          >
            {t('d_arrived')}
          </Button>
        </span>
      )}
      {more.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 self-start"
              aria-label={t('bk_row_more', { party: row.name ?? t('no_name') })}
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
