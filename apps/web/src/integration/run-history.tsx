'use client'

// The run history of an instance or of one venue (D82), collapsed: one line shows the last run, and
// the list of the latest 20 opens under a button (Martin: no long scroll). A row shows what ran,
// for which venue (the instance's history only: a venue's own history is all one venue), when (the
// given clock), how long, how it ended and its counters; it opens to the notes of the run (what it
// skipped and why, or the error) and the writes `apply()` refused (the field and the reason, never
// an id from the system). Runs recorded before structured details existed show their text instead.
//
// What a run is called comes from the system's connector (`connectors.<kind>.runKinds`); only the
// neutral kinds are named here.
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  HistoryIcon,
  Loader2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { RunView } from '@/server/integration/view'

import {
  deletionCheckSkipped,
  isKnownRefusalCode,
  listedCounters,
  runDurationMs,
  splitDuration,
} from './format'
import { useMoment } from './use-moment'

const STATUS_BADGE = {
  queued: { variant: 'secondary', icon: CircleDashedIcon },
  running: { variant: 'info', icon: Loader2Icon },
  completed: { variant: 'success', icon: CheckCircle2Icon },
  failed: { variant: 'danger', icon: XCircleIcon },
} as const

/** Runs of kinds the platform names itself; every other kind is named by the system's connector. */
const NEUTRAL_RUN_KINDS = ['places_read'] as const

interface HistoryProps {
  readonly runs: readonly RunView[]
  /** The clock the times are shown in. */
  readonly timeZone: string
  /** The connector kind of the instance the runs belong to: names the runs. */
  readonly connector: string
  /** The connector's name for the system (`{source}`). */
  readonly source: string
  /** Name the venue of each run (the instance's history); a venue's own history leaves it out. */
  readonly showVenue: boolean
}

/** The words for a kind of run: a neutral one, else the connector's, else "Other". */
function useRunKindLabel(connector: string): (kind: string) => string {
  const t = useTranslations('integration.history')
  const connectors = useTranslations('connectors')
  return (kind) => {
    if ((NEUTRAL_RUN_KINDS as readonly string[]).includes(kind)) return t(`kind.${kind}`)
    const key = `${connector}.runKinds.${kind}`
    return connectors.has(key) ? connectors(key) : t('kind.other')
  }
}

function RunRow({
  run,
  timeZone,
  connector,
  source,
  showVenue,
}: { run: RunView } & Omit<HistoryProps, 'runs'>) {
  const t = useTranslations('integration.history')
  const kindLabel = useRunKindLabel(connector)
  const moment = useMoment(timeZone)
  const [open, setOpen] = useState(false)
  const started = moment(run.startedAt)
  const duration = runDurationMs(run)
  const split = duration === null ? null : splitDuration(duration)
  const badge = STATUS_BADGE[run.status]
  const Icon = badge.icon
  const counters = listedCounters(run.counters)
  const skipped = deletionCheckSkipped(run)
  // A held pull skipped its deletion check too; the more specific badge says it.
  const held = run.details?.absenceHeld !== undefined
  const notes = run.details ? run.details.notes : run.errorSummary ? [run.errorSummary] : []
  const refused = run.details?.refused ?? []
  const label = started ?? t('status.queued')

  return (
    <li className="grid gap-2 py-3" data-testid="run-row" data-status={run.status}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-label={t(open ? 'details.hide' : 'details.show', { when: label })}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
        </Button>
        <span className="min-w-32 text-sm font-medium">{kindLabel(run.kind)}</span>
        {showVenue ? (
          <span className="min-w-28 text-sm text-muted-foreground" data-testid="run-venue">
            {run.venue?.name ?? '—'}
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground" data-testid="run-started">
          {started ?? '—'}
        </span>
        <span className="text-sm text-muted-foreground" data-testid="run-duration">
          {split === null
            ? t('duration.none')
            : split.minutes > 0
              ? t('duration.minutes', split)
              : t('duration.seconds', { seconds: split.seconds })}
        </span>
        <Badge variant={badge.variant} data-testid="run-status">
          <Icon aria-hidden className={run.status === 'running' ? 'animate-spin' : undefined} />
          {t(`status.${run.status}`)}
        </Badge>
        {held ? (
          <Badge variant="warning" data-testid="run-held">
            {t('held')}
          </Badge>
        ) : skipped ? (
          <Badge variant="warning" data-testid="run-deletion-skipped">
            {t('deletionSkipped')}
          </Badge>
        ) : null}
      </div>

      {counters.length > 0 ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 ps-8 text-xs" data-testid="run-counters">
          {counters.map(({ key, value }) => (
            <div key={key} className="flex gap-1">
              <dt className="text-muted-foreground">{t(`counters.${key}`, { source })}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {open ? (
        <div className="grid gap-3 ps-8 text-sm" data-testid="run-details">
          {notes.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">{t('details.notes')}</p>
              <ul className="list-disc ps-5 text-muted-foreground">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {refused.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">{t('details.refused')}</p>
              <table className="w-full text-start text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pe-3 text-start font-medium">{t('details.field')}</th>
                    <th className="py-1 text-start font-medium">{t('details.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {refused.map((entry, index) => (
                    // Refusals repeat (many items, one field, one reason): the position is the key.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a list that never reorders
                    <tr key={index} className="border-t" data-testid="refused-write">
                      <td className="py-1 pe-3 align-top">
                        {entry.fieldKey ? (
                          <code className="font-mono">{entry.fieldKey}</code>
                        ) : (
                          t('details.noField')
                        )}
                      </td>
                      <td className="py-1 align-top">
                        {isKnownRefusalCode(entry.code) ? (
                          t(`refusedCodes.${entry.code}`, { source })
                        ) : (
                          <>
                            {t('details.refusedFallback')}{' '}
                            <code className="font-mono">{entry.code}</code>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {notes.length === 0 && refused.length === 0 ? (
            <p className="text-muted-foreground">{t('details.nothing')}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function RunHistory({ runs, timeZone, connector, source, showVenue }: HistoryProps) {
  const t = useTranslations('integration.history')
  const kindLabel = useRunKindLabel(connector)
  const moment = useMoment(timeZone)
  const [open, setOpen] = useState(false)
  const last = runs[0]

  if (last === undefined) {
    return (
      <Empty className="min-h-32" data-testid="history-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="history-last">
          {t('last', {
            kind: kindLabel(last.kind),
            status: t(`status.${last.status}`),
            when: moment(last.startedAt) ?? '—',
          })}
        </p>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" data-testid="history-toggle">
            {open ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
            {open ? t('hide') : t('show', { count: runs.length })}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="mt-2 divide-y" data-testid="run-history">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              timeZone={timeZone}
              connector={connector}
              source={source}
              showVenue={showVenue}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
