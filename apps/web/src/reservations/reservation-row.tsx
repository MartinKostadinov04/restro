'use client'

// One reservation on a row (#326; Patterns: "A list of records"). Everything the night needs at a
// glance and nothing more: the hour, the name, the party, the spots and the state. No colour
// carries a state by itself — the state is a word, and "Late" is a word on a tint, explained once
// under the filters. One tap opens the whole reservation.
import { ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import type { RvRowView } from '@/server/reservations/view'

import { useByClubWord, useGuestsText, useStatusWord } from './reservation-words'

export function ReservationRow({ row, onOpen }: { row: RvRowView; onOpen: () => void }) {
  const t = useTranslations('reservations')
  const word = useStatusWord()
  const guests = useGuestsText()
  const byClub = useByClubWord()
  const parts = [
    guests(row.partySize),
    row.spots.length === 0 ? null : row.spots.join(', '),
    row.kind === 'walk_in' ? t('walk_in') : null,
  ].filter((part): part is string => part !== null)

  return (
    <li data-testid="rv-row" data-status={row.status} data-late={row.late ? 'yes' : 'no'}>
      <button
        type="button"
        className="flex min-h-11 w-full items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
    </li>
  )
}
