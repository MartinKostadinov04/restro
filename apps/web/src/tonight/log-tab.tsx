'use client'

// Tonight, screen 3: the Log (#86; plan `docs/deliverables/2026-10-27-tonight-log-plan.md`), only
// for roles holding `log.view`. One line per entry, newest first, for any service day the Log
// still holds: the time, one sentence, the table and the reference where there are some, and who.
// It only reads; nothing is answered here. No state colours. A line about a sent order or a payment
// opens its sheet and carries a chevron; any other line does nothing and carries none. A sent order
// is one row with its latest step, its older steps folded under it (S15, `log-groups.ts`); a row
// stays unfolded while new steps arrive. Search and the Kind filter cover the whole day, not only
// the lines loaded.
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ListFilterIcon,
} from 'lucide-react'
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
import { foldOrderSteps } from './log-groups'
import { logSentence, type Say } from './log-sentence'
import { useMoney } from './money'
import { PAGE } from './pages'
import { PaymentSheet } from './payment-sheet'
import { paymentStateWords } from './payment-state-words'
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
  const [payment, setPayment] = useState<string | null>(null)
  /** The sent orders whose steps are open, by sent order: a new step keeps them open. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
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
      paymentStates: paymentStateWords(say),
    })

  const body = (() => {
    if (feed.failed) return <FailedBlock text={t('lg_fail')} />
    if (shown.rows.length === 0 && feed.loading) return <RowsSkeleton />
    if (shown.rows.length === 0) {
      return <NothingHere text={t('lg_empty')} />
    }
    /** Who and where, under a line's sentence: the table, the reference and the person. */
    const meta = (line: LogLineView) => (
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
    )
    return (
      <ul className="divide-y rounded-lg border" data-testid="log-list">
        {/* Only lines with a sentence are folded, so a sent order's row always heads with one. */}
        {foldOrderSteps(shown.rows.filter((each) => sentence(each) !== null)).map(
          ({ line, steps }) => {
            const words = sentence(line)
            if (words === null) return null
            const opens = line.sentOrderId ?? line.paymentId
            const order = line.sentOrderId
            const expanded = order !== null && unfolded.has(order)
            const content = (
              <>
                <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {line.time}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm [overflow-wrap:anywhere]">
                    {words}
                    {steps.length === 0 ? null : (
                      <span className="text-muted-foreground" data-testid="log-steps-count">
                        {` · ${t('lg_steps', { n: steps.length + 1 })}`}
                      </span>
                    )}
                  </span>
                  {meta(line)}
                </span>
                {opens === null ? null : (
                  <ChevronRightIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                )}
              </>
            )
            const row =
              opens === null ? (
                <div className="flex min-h-11 flex-1 items-start gap-3 p-3">{content}</div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-11 w-full min-w-0 flex-1 items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => (line.sentOrderId === null ? setPayment(opens) : setOpen(opens))}
                >
                  {content}
                </button>
              )
            return (
              <li key={line.seq} data-testid="log-line" data-kind={line.kind}>
                {steps.length === 0 ? (
                  row
                ) : (
                  <>
                    <div className="flex items-start">
                      {row}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="m-0.5 size-11 shrink-0"
                        aria-expanded={expanded}
                        aria-label={t(expanded ? 'lg_steps_hide' : 'lg_steps_show')}
                        data-testid="log-steps-toggle"
                        onClick={() =>
                          setUnfolded((before) => {
                            if (order === null) return before
                            const next = new Set(before)
                            if (next.has(order)) next.delete(order)
                            else next.add(order)
                            return next
                          })
                        }
                      >
                        {expanded ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
                      </Button>
                    </div>
                    {expanded ? (
                      <ul className="border-t bg-muted/40" data-testid="log-steps">
                        {steps.map((step) => (
                          <li
                            key={step.seq}
                            className="flex items-start gap-3 py-2 pr-3 pl-6"
                            data-testid="log-step"
                          >
                            <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
                              {step.time}
                            </span>
                            <span className="min-w-0 flex-1 space-y-0.5">
                              <span className="block text-sm [overflow-wrap:anywhere]">
                                {sentence(step)}
                              </span>
                              {meta(step)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </li>
            )
          },
        )}
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
      {payment === null ? null : (
        <PaymentSheet frame={frame} paymentId={payment} onClose={() => setPayment(null)} />
      )}
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
    <RunProvider asks={frame.asks}>
      <Content initial={initial} frame={frame} />
    </RunProvider>
  )
}
