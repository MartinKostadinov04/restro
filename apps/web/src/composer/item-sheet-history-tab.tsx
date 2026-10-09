'use client'

// The History tab: the item's changelog as a vertical timeline, newest first, a page at a time.
// Ported from the Platform's changelog timeline (PassportEdit.jsx 201-258: an icon on a rail,
// "X was changed from A to B"). Changed: the lines come from the append-only `events` table (who,
// when, which layer), not an array inside the record; values are drawn by the field-type registry
// (the Platform printed them through its own switch); the list is paged.
import { PencilIcon, PlusIcon, Undo2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Fragment, type ReactNode, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { bcp47, useFieldEnvironment } from '@/fields/environment'
import { pickLocalized } from '@/fields/localized'
import { ProvenanceBadge } from '@/fields/provenance-badge'
import { FieldValueView } from '@/fields/registry'
import { loadItemHistoryAction } from '@/server/item-sheet/actions'
import type { HistoryEntry, HistoryPage } from '@/server/item-sheet/types'

import { layerProvenance, marks, splitMarks } from './item-sheet-support'

export interface ItemSheetHistoryTabProps {
  venueId: string
  itemId: string
  /** Changes with every saved change: the history reloads from the first page. */
  revision: number
  /** For tests: replaces the server action. */
  load?: (venueId: string, itemId: string, before?: number) => Promise<HistoryPage>
}

const ICON = { set: PlusIcon, changed: PencilIcon, cleared: Undo2Icon } as const

/** A value drawn by its field type's Display; a field the template no longer has, as plain text. */
function EntryValue({ entry, value }: { entry: HistoryEntry; value: unknown }) {
  if (entry.definition) {
    return (
      <div className="inline-block max-w-full rounded-md border bg-background px-1.5 py-0.5 align-middle text-foreground">
        <FieldValueView definition={entry.definition} value={value} />
      </div>
    )
  }
  return (
    <code className="rounded-md border bg-background px-1.5 py-0.5 text-xs break-all">
      {JSON.stringify(value)}
    </code>
  )
}

function EntryLine({ entry, last }: { entry: HistoryEntry; last: boolean }) {
  const t = useTranslations('itemSheet.history')
  const environment = useFieldEnvironment()
  const label = entry.definition
    ? (pickLocalized(entry.definition.label, environment.locale) ?? entry.fieldKey)
    : entry.fieldKey
  const who =
    entry.actor.kind === 'user'
      ? (entry.actor.name ?? t('someone'))
      : entry.actor.kind === 'integration'
        ? t('barsySync')
        : t('system')
  const provenance = layerProvenance(entry.layer)
  const Icon = ICON[entry.kind]
  // What goes where the message has {who}, {field}, {value}, {from} and {to}.
  const pieces: Record<string, ReactNode> = {
    who: <span className="font-semibold text-foreground">{who}</span>,
    field: <span className="font-semibold text-foreground">{label}</span>,
    value: (
      <EntryValue
        entry={entry}
        value={entry.kind === 'cleared' ? entry.oldValue : entry.newValue}
      />
    ),
    from: <EntryValue entry={entry} value={entry.oldValue} />,
    to: <EntryValue entry={entry} value={entry.newValue} />,
  }
  const when = new Intl.DateTimeFormat(bcp47(environment), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: environment.timezone,
  }).format(new Date(entry.at))

  return (
    <li data-testid="history-entry" data-field={entry.fieldKey} data-kind={entry.kind}>
      <div className="relative flex gap-3 pb-6">
        {last ? null : (
          <span
            aria-hidden
            className="absolute top-8 left-4 -ml-px h-[calc(100%-2rem)] w-0.5 bg-border"
          />
        )}
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background ring-4 ring-background">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-1.5 pt-1">
          <div className="text-sm leading-7 text-muted-foreground" data-testid="history-sentence">
            {splitMarks(t(entry.kind, marks('who', 'field', 'value', 'from', 'to'))).map(
              (part, index) => {
                const key = `${index}:${part.kind === 'text' ? part.text : part.name}`
                if (part.kind === 'text') return <Fragment key={key}>{part.text}</Fragment>
                return <Fragment key={key}>{pieces[part.name]}</Fragment>
              },
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <time dateTime={entry.at}>{when}</time>
            {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
          </div>
        </div>
      </div>
    </li>
  )
}

export function ItemSheetHistoryTab({
  venueId,
  itemId,
  revision,
  load = loadItemHistoryAction,
}: ItemSheetHistoryTabProps) {
  const t = useTranslations('itemSheet.history')
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [more, setMore] = useState(false)

  // The first page again whenever the item changed (a save, or another item).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the reload trigger
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    load(venueId, itemId)
      .then((page) => {
        if (cancelled) return
        setEntries(page.entries)
        setNextBefore(page.nextBefore)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [venueId, itemId, revision, load])

  const loadMore = useCallback(async () => {
    if (nextBefore === null) return
    setMore(true)
    try {
      const page = await load(venueId, itemId, nextBefore)
      setEntries((current) => [...current, ...page.entries])
      setNextBefore(page.nextBefore)
    } catch {
      setStatus('error')
    } finally {
      setMore(false)
    }
  }, [load, venueId, itemId, nextBefore])

  if (status === 'loading') {
    return (
      <div className="grid gap-4" data-testid="item-sheet-history" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="item-sheet-history">
        {t('error')}
      </p>
    )
  }
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="item-sheet-history">
        {t('empty')}
      </p>
    )
  }
  return (
    <div className="grid gap-2" data-testid="item-sheet-history">
      <ol>
        {entries.map((entry, index) => (
          <EntryLine
            key={entry.seq}
            entry={entry}
            last={index === entries.length - 1 && nextBefore === null}
          />
        ))}
      </ol>
      {nextBefore !== null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-center"
          disabled={more}
          onClick={() => void loadMore()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  )
}
