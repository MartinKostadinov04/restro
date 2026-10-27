'use client'

// Tonight, screen 3: the Log (#86; plan `docs/deliverables/2026-10-27-tonight-log-plan.md`), only
// for roles holding `log.view`. One line per entry, newest first, for any service day the Log
// still holds: the time, one sentence, the table and the reference where there are some, and who.
// It only reads; nothing is answered here. No state colours. A line about a sent order opens that
// order's sheet (screen 2's); any other line does nothing and carries no chevron. Search and the
// Kind filter cover the whole day, not only the lines loaded.
import { CheckIcon, ChevronRightIcon, ListFilterIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { logAction } from '@/server/tonight/night-actions'
import type { Frame, LogLineView, LogView } from '@/server/tonight/night-view'

import { DayPicker } from './day-picker'
import { useLiveFeed } from './live-feed'
import { LogExport } from './log-export'
import { logSentence, type Say } from './log-sentence'
import { useMoney } from './money'
import { PAGE } from './pages'
import { PAYMENT_STATE_WORDS } from './payment-state-words'
import { RunProvider } from './run'
import { SearchField, useDebounced } from './search-field'
import { SentOrderSheet } from './sent-sheet'
import {
  FailedBlock,
  NewLine,
  NothingHere,
  RowsSkeleton,
  ShowEarlier,
  TabHeading,
} from './tab-parts'
import { useTableName } from './table-name'
import { useWho } from './who'

/** The Kind filter's choices (plan §8): "All", then the four groups. */
const GROUPS = [
  ['all', 'lg_k_all'],
  ['orders', 'lg_k_orders'],
  ['money', 'lg_k_money'],
  ['pauses', 'lg_k_pauses'],
  ['settings', 'lg_k_settings'],
] as const

function Content({ initial, frame }: { initial: LogView; frame: Frame }) {
  const t = useTranslations('tonight')
  const say: Say = (key, values) => t(key as never, values as never)
  const money = useMoney()
  const tableName = useTableName()
  const who = useWho()
  const [text, setText] = useState('')
  const search = useDebounced(text.trim(), 250)
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>('all')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)
  const day = initial.day

  const feed = useLiveFeed<LogView>({
    initial,
    query: [search, group, limit],
    // A night that is over has nothing new to come.
    live: initial.today,
    keysOf: (view) => view.rows.map((row) => row.seq),
    refresh: (shown, latest) => ({
      ...latest,
      rows: shown.rows.map((row) => latest.rows.find((fresh) => fresh.seq === row.seq) ?? row),
    }),
    load: async () => {
      const result = await logAction({
        venueId: frame.venueId,
        day,
        search,
        ...(group === 'all' ? {} : { group }),
        limit,
      })
      return result.ok ? result.log : null
    },
  })
  const { shown } = feed

  const sentence = (line: LogLineView): string | null =>
    logSentence(line, {
      say,
      table: (l) => (l.table === null ? t('lg_no_table') : tableName(l.table, l.numbered)),
      who,
      money: (minor) => money(minor, frame.currency),
      source: frame.source,
      paymentStates: PAYMENT_STATE_WORDS,
    })

  const body = (() => {
    if (feed.failed) return <FailedBlock text={t('lg_fail')} />
    if (shown.rows.length === 0 && feed.loading) return <RowsSkeleton />
    if (shown.rows.length === 0) {
      return <NothingHere text={t('lg_empty')} />
    }
    return (
      <ul className="divide-y rounded-lg border" data-testid="log-list">
        {shown.rows.map((line) => {
          const words = sentence(line)
          if (words === null) return null
          const opens = line.sentOrderId
          const content = (
            <>
              <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
                {line.time}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-sm [overflow-wrap:anywhere]">{words}</span>
                <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
                  {[
                    line.table === null ? null : (
                      <span key="table" className="[overflow-wrap:anywhere]">
                        {tableName(line.table, line.numbered)}
                      </span>
                    ),
                    line.reference === null ? null : (
                      <span key="reference" className="font-mono font-medium text-foreground">
                        {line.reference}
                      </span>
                    ),
                    <span key="who">{who(line.by)}</span>,
                  ]
                    .filter((part) => part !== null)
                    .flatMap((part, index) => [
                      index === 0 ? null : (
                        <span key={`dot${part.key}`} aria-hidden>
                          ·
                        </span>
                      ),
                      part,
                    ])}
                </span>
              </span>
              {opens === null ? null : (
                <ChevronRightIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
              )}
            </>
          )
          return (
            <li key={line.seq} data-testid="log-line" data-kind={line.kind}>
              {opens === null ? (
                <div className="flex min-h-11 items-start gap-3 p-3">{content}</div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpen(opens)}
                >
                  {content}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  })()

  const kindLabel = t(GROUPS.find(([value]) => value === group)?.[1] ?? 'lg_k_all')

  return (
    <div className="space-y-4" data-testid="tonight-log">
      <TabHeading name={t('tab_log')} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={text}
          label={t('lg_search')}
          onChange={(value) => {
            setText(value)
            setLimit(PAGE)
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="h-11" data-testid="kind-button">
              <ListFilterIcon aria-hidden />
              {t('lg_kind', { kind: kindLabel })}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {GROUPS.map(([value, key]) => (
              <DropdownMenuItem
                key={value}
                className="min-h-11"
                data-testid={`kind-${value}`}
                onSelect={() => {
                  setGroup(value)
                  setLimit(PAGE)
                }}
              >
                <CheckIcon aria-hidden className={group === value ? '' : 'invisible'} />
                {t(key)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DayPicker day={day} today={frame.today} days={shown.days} />
        {frame.canExport ? <LogExport venueId={frame.venueId} today={frame.today} /> : null}
      </div>
      {initial.today ? null : (
        <p className="text-sm text-muted-foreground" data-testid="log-kept">
          {t('lg_kept')}
        </p>
      )}
      <div aria-busy={feed.loading} className="space-y-2">
        <NewLine k={feed.fresh} onShow={feed.show} />
        {body}
        {shown.hasMore && !feed.failed ? (
          <ShowEarlier onClick={() => setLimit((before) => before + PAGE)} />
        ) : null}
      </div>
      {open === null ? null : (
        <SentOrderSheet
          frame={frame}
          sentOrderId={open}
          onClose={() => setOpen(null)}
          onChanged={feed.reload}
        />
      )}
    </div>
  )
}

/** The Log of one night, for a venue. Keyed by the day at the call site, so a new day starts clean. */
export function LogTab({ initial, frame }: { initial: LogView; frame: Frame }) {
  return (
    <RunProvider>
      <Content initial={initial} frame={frame} />
    </RunProvider>
  )
}
