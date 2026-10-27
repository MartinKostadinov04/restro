'use client'

// Tonight, screen 4: the end of the night (#86; plan
// `docs/deliverables/2026-10-27-tonight-end-of-night-plan.md`). One column, one service day: what
// still needs fixing first, then the sent orders, then the totals, in the settled order (D122 §7);
// part 2's sections slot in between (night-slots.ts). The page reads: its answers are the same
// outline pairs as screen 1, "Download CSV" is outline, and nothing on it is filled. A row of jump
// links on a phone scrolls to each section. Before the service day ends the numbers are counted
// live and the page asks again every few seconds; after, they are the day's written totals.
import { CheckIcon, DownloadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { sentOrdersAction } from '@/server/tonight/night-actions'
import type { Frame, NightView, SentListView } from '@/server/tonight/night-view'

import { ActionRowItem } from './action-rows'
import { DayPicker, useDateText } from './day-picker'
import { useMoney } from './money'
import { type NightSlots, visibleSections } from './night-slots'
import { PAGE } from './pages'
import { RunProvider } from './run'
import { SentRow } from './sent-row'
import { SentOrderSheet } from './sent-sheet'
import { FailedBlock, NothingHere, TabHeading } from './tab-parts'
import { useTableName } from './table-name'
import { useWho } from './who'

/** How often a live night asks the server again. */
const REFRESH_MS = 5000

function clockAt(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(iso))
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        {title}
        {count === undefined ? null : (
          <span className="ml-2 text-muted-foreground" data-testid={`${id}-count`}>
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}

function Content({ view, frame, slots }: { view: NightView; frame: Frame; slots: NightSlots }) {
  const t = useTranslations('tonight')
  const router = useRouter()
  const money = useMoney()
  const who = useWho()
  const tableName = useTableName()
  const dateText = useDateText()
  const [open, setOpen] = useState<string | null>(null)
  // "Show all {n}" expands the full list in place, in pages of 100.
  const [all, setAll] = useState<{
    limit: number
    list: SentListView | null
    failed: boolean
  } | null>(null)

  useEffect(() => {
    if (!view.today) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [view.today, router])

  const day = view.day
  const limit = all?.limit
  useEffect(() => {
    if (limit === undefined) return
    let live = true
    void sentOrdersAction({ venueId: frame.venueId, day, limit }).then((result) => {
      if (!live) return
      setAll((before) =>
        before === null
          ? before
          : result.ok
            ? { ...before, list: result.list, failed: false }
            : { ...before, failed: true },
      )
    })
    return () => {
      live = false
    }
  }, [limit, day, frame.venueId])

  const sections = visibleSections(slots.sections, view.full)
  const counts = view.sent.counts
  const shownRows = all?.list?.rows ?? view.sent.rows
  const canShowAll = all === null && counts.all > view.sent.rows.length
  const refreshed = () => router.refresh()

  const jumps = [
    { id: 'night-fix', label: t('nt_fix') },
    { id: 'night-sent', label: t('nt_sent') },
    ...sections.map((section) => ({ id: `night-${section.id}`, label: section.label })),
    { id: 'night-totals', label: t('nt_totals') },
  ]

  const totals: [string, string][] = [
    [t('nt_t_tables'), String(view.totals.sittings)],
    [t('nt_t_sent'), String(view.totals.sentOrders)],
    [t('nt_t_added'), String(view.totals.sentOrdersAdded)],
    [t('nt_t_added_amt'), money(view.totals.addedMinor, frame.currency)],
    [t('nt_t_notsent'), String(view.totals.sentOrdersNotSent)],
    [t('nt_t_unconf'), String(view.totals.sentOrdersUnconfirmed)],
    [t('nt_t_calls'), String(view.totals.waiterCalls)],
    [t('nt_t_pauses'), String(view.totals.pauses)],
    [t('nt_t_alerts'), String(view.totals.alerts)],
  ]

  return (
    <div className="mx-auto w-full max-w-[840px] space-y-6" data-testid="tonight-night">
      <TabHeading name={t('tab_night')} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold" data-testid="night-day">
            {t('nt_day', { date: dateText(view.day) })}
          </h3>
          <p className="text-sm text-muted-foreground" data-testid="night-state">
            {view.today
              ? t('nt_live', { time: view.dayEndsAt })
              : t('nt_closed', { time: view.dayEndsAt })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DayPicker day={view.day} today={frame.today} days={view.days} />
          {view.full && view.hasService ? (
            <Button asChild variant="outline" className="h-11">
              <a
                href={`/api/venues/${frame.venueId}/night?day=${view.day}`}
                download
                data-testid="night-csv"
              >
                <DownloadIcon aria-hidden />
                {t('nt_csv')}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {!view.hasService ? (
        <NothingHere text={t('nt_none')} />
      ) : (
        <>
          <nav aria-label={t('nt_jump')} className="flex flex-wrap gap-2 lg:hidden">
            {jumps.map((jump) => (
              <Button key={jump.id} asChild variant="outline" className="h-11">
                <a href={`#${jump.id}`}>{jump.label}</a>
              </Button>
            ))}
          </nav>

          <Section
            id="night-fix"
            title={t('nt_fix')}
            count={view.fix.length + view.answered.length}
          >
            {view.fix.length === 0 && view.answered.length === 0 && slots.fix === null ? (
              <p
                className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground"
                data-testid="night-fix-none"
              >
                <CheckIcon aria-hidden className="size-4" />
                {t('nt_fix_none')}
              </p>
            ) : (
              <ul className="space-y-3" data-testid="night-fix-list">
                {view.fix.map((row) => (
                  <ActionRowItem
                    key={row.id}
                    row={row}
                    view={frame}
                    primary={false}
                    ago={view.today ? '' : clockAt(row.at, frame.timezone)}
                  />
                ))}
                {view.answered.map((row) => (
                  <li
                    key={row.sentOrderId}
                    className="rounded-lg border bg-card p-4 text-sm"
                    data-testid="night-fix-answered"
                  >
                    <span className="font-mono font-bold">{row.reference}</span>
                    {' · '}
                    {tableName(row.table, row.numbered)}
                    <span className="block text-muted-foreground">
                      {t('so_answered', {
                        answer: t(row.answer === 'found' ? 's_ok' : 's_no'),
                        who: who(row.by),
                      })}
                    </span>
                  </li>
                ))}
                {slots.fix}
              </ul>
            )}
          </Section>

          <Section id="night-sent" title={t('nt_sent')}>
            <p className="text-sm text-muted-foreground" data-testid="night-sent-summary">
              {t('nt_sent_sum', {
                n: counts.all,
                a: counts.added,
                ns: counts.notSent,
                u: counts.unconfirmed,
              })}
            </p>
            {all?.failed ? <FailedBlock text={t('so_fail')} /> : null}
            {shownRows.length === 0 ? null : (
              <ul className="space-y-2" data-testid="night-sent-list">
                {shownRows.map((row) => (
                  <SentRow
                    key={row.id}
                    row={row}
                    source={frame.source}
                    currency={frame.currency}
                    onOpen={setOpen}
                  />
                ))}
              </ul>
            )}
            {canShowAll ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                data-testid="night-show-all"
                onClick={() => setAll({ limit: PAGE, list: null, failed: false })}
              >
                {t('nt_show_all', { n: counts.all })}
              </Button>
            ) : null}
            {all?.list?.hasMore ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                data-testid="show-earlier"
                onClick={() => setAll({ ...all, limit: all.limit + PAGE })}
              >
                {t('so_earlier')}
              </Button>
            ) : null}
          </Section>

          {sections.map((section) => (
            <div key={section.id} id={`night-${section.id}`} className="scroll-mt-4">
              {section.node}
            </div>
          ))}

          <Section id="night-totals" title={t('nt_totals')}>
            <dl className="divide-y rounded-lg border" data-testid="night-totals-list">
              {totals.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 p-3 text-sm">
                  <dt className="min-w-0 [overflow-wrap:anywhere]">{label}</dt>
                  <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
              {slots.totals}
            </dl>
          </Section>
        </>
      )}
      {open === null ? null : (
        <SentOrderSheet
          frame={frame}
          sentOrderId={open}
          onClose={() => setOpen(null)}
          onChanged={refreshed}
        />
      )}
    </div>
  )
}

/** The end of one night for a venue. */
export function NightPage(props: { view: NightView; frame: Frame; slots: NightSlots }) {
  return (
    <RunProvider>
      <Content {...props} />
    </RunProvider>
  )
}

/** The page when it could not be read: the failure block; it asks again by itself. */
export function NightFailed() {
  const t = useTranslations('tonight')
  const router = useRouter()
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [router])
  return <FailedBlock text={t('nt_fail')} />
}
