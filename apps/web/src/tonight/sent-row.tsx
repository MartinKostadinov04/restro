'use client'

// One sent order on a row (sent-orders plan §3, §5), used by the sent orders list and the end of
// the night: the reference (16 px, mono, bold), the table, the item count and total, the state as
// icon and word, the time. Only "Check the bill" (Unconfirmed, not answered) is coloured: the
// accent tint with icon and word. Everything else is neutral. The whole row is one button that
// opens the sheet.
import {
  BanIcon,
  CheckIcon,
  ClockIcon,
  HourglassIcon,
  type LucideIcon,
  SearchCheckIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import type { SentRowView, StateWord } from '@/server/tonight/night-view'

import { useMoney } from './money'
import { useTableName } from './table-name'
import { useWho } from './who'

const ICONS: Readonly<Record<StateWord, LucideIcon>> = {
  waiting: ClockIcon,
  sending: ClockIcon,
  checking: ClockIcon,
  added: CheckIcon,
  approval: HourglassIcon,
  notsent: BanIcon,
  check: SearchCheckIcon,
}

/** The state's word, e.g. "Added" ("Approve it in {source}" names the POS). */
export function useStateWord() {
  const t = useTranslations('tonight')
  return (state: StateWord, source: string) =>
    state === 'approval' ? t('st_approval', { source }) : t(`st_${state}`)
}

/** The reason's word, e.g. "sold out". */
export function useReasonWord() {
  const t = useTranslations('tonight')
  return (reason: NonNullable<SentRowView['reason']>, source: string) =>
    t(`rs_${reason}`, { source })
}

export function SentRow({
  row,
  source,
  currency,
  onOpen,
}: {
  row: SentRowView
  source: string
  currency: string
  onOpen: (id: string) => void
}) {
  const t = useTranslations('tonight')
  const money = useMoney()
  const tableName = useTableName()
  const word = useStateWord()
  const reason = useReasonWord()
  const who = useWho()
  const Icon = ICONS[row.state]
  const needsAnswer = row.state === 'check'
  const answered =
    row.answer === null
      ? null
      : t('so_answered', {
          answer: t(row.answer.answer === 'found' ? 's_ok' : 's_no'),
          who: who(row.answer.by),
        })

  return (
    <li>
      <button
        type="button"
        data-testid="sent-row"
        data-state={row.state}
        data-reference={row.reference}
        onClick={() => onOpen(row.id)}
        className={cn(
          'flex min-h-14 w-full items-start gap-3 rounded-lg border p-3 text-left text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          needsAnswer ? 'border-info/40 bg-info/10' : 'bg-card',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
            needsAnswer ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-mono text-base font-bold">{row.reference}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{row.time}</span>
          </span>
          <span className="block text-sm [overflow-wrap:anywhere]">
            {tableName(row.table, row.numbered)}
            <span className="text-muted-foreground">
              {' · '}
              {t('so_items', { n: row.itemCount })}
              {' · '}
              <span className="tabular-nums">{money(row.totalMinor, currency)}</span>
            </span>
          </span>
          <span
            className={cn('block text-sm [overflow-wrap:anywhere]', needsAnswer && 'font-medium')}
          >
            {word(row.state, source)}
            {row.reason === null ? null : (
              <span className="text-muted-foreground"> · {reason(row.reason, source)}</span>
            )}
          </span>
          {answered === null ? null : (
            <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {answered}
            </span>
          )}
          {row.landedAt === null ? null : (
            <span className="block text-sm text-muted-foreground" data-testid="landed-late">
              {t('so_found', { time: row.landedAt })}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
