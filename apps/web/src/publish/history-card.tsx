'use client'

// "Versions": every publish and every return to an earlier version, newest first, 20 to a page,
// with when, why, by whom and what it changed. Each version that can be returned to has a button
// that asks first ("Return to version N?"); the live one is marked.
import { UndoIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormSection } from '@/components/ui/form-section'
import { useMoment } from '@/integration/use-moment'
import { loadHistoryPageAction } from '@/server/publish/actions'
import {
  type HistoryPage,
  isLiveEntry,
  isReturnable,
  type PublishView,
  type VersionCounts,
  type VersionEntry,
} from '@/server/publish/view'
import { useActorLabel } from './names'

/** The change counts of a version in words: "1 with a new price, 2 added". */
function CountsText({ counts }: { counts: VersionCounts }) {
  const t = useTranslations('publish.changes.summary')
  const parts = [
    counts.added > 0 ? t('added', { count: counts.added }) : null,
    counts.hidden > 0 ? t('hidden', { count: counts.hidden }) : null,
    counts.priceChanged > 0 ? t('prices', { count: counts.priceChanged }) : null,
    counts.renamed > 0 ? t('renamed', { count: counts.renamed }) : null,
    counts.otherChanged > 0 ? t('other', { count: counts.otherChanged }) : null,
    counts.areas > 0 ? t('areas', { count: counts.areas }) : null,
  ].filter((part): part is string => part !== null)
  const empty = useTranslations('publish.history')('noChange')
  return <>{parts.length > 0 ? parts.join(', ') : empty}</>
}

function EntryRow({
  entry,
  view,
  busy,
  onReturn,
}: {
  entry: VersionEntry
  view: PublishView
  busy: boolean
  onReturn: (entry: VersionEntry) => void
}) {
  const t = useTranslations('publish.history')
  const tLive = useTranslations('publish.live')
  const moment = useMoment(view.timeZone)
  const actorLabel = useActorLabel()
  const liveVersion = view.live?.version ?? null
  const live = isLiveEntry(entry, liveVersion)
  const returnable = view.canPublish && isReturnable(entry, liveVersion)

  let what: React.ReactNode
  if (entry.reason === 'rollback') {
    what =
      entry.restoresVersion === null
        ? t('returnedToUnknown')
        : t('returnedTo', { version: entry.restoresVersion })
  } else if (entry.status === 'held' || entry.status === 'rejected') {
    what = entry.held
      ? t('heldText', { hidden: entry.held.hidden, total: entry.held.previouslyVisible })
      : null
  } else if (entry.counts !== null) {
    what = <CountsText counts={entry.counts} />
  } else if (entry.first) {
    what = t('first')
  } else {
    what = null
  }

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
      data-testid="history-row"
      data-version={entry.version}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{t('version', { version: entry.version })}</span>
          {live ? <Badge variant="success">{t('live')}</Badge> : null}
          {entry.status === 'held' ? <Badge variant="warning">{t('held')}</Badge> : null}
          {entry.status === 'rejected' ? (
            <Badge variant="secondary">
              {entry.decisionNote === 'superseded' ? t('superseded') : t('rejected')}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            moment(entry.at),
            entry.reason === 'rollback' ? null : tLive(`reason.${entry.reason}`),
            actorLabel(entry.actor),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {what !== null && what !== '' ? (
          <p className="text-sm" data-testid="history-what">
            {what}
          </p>
        ) : null}
      </div>
      {returnable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onReturn(entry)}
          data-testid="history-return"
        >
          <UndoIcon aria-hidden />
          {t('return')}
        </Button>
      ) : null}
    </li>
  )
}

export function HistoryCard({
  view,
  busy,
  returnTo,
}: {
  view: PublishView
  busy: boolean
  returnTo: (snapshotId: string, version: number) => Promise<boolean>
}) {
  const t = useTranslations('publish.history')
  const tConfirm = useTranslations('publish.confirm')
  const [older, setOlder] = useState<HistoryPage | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loading, startLoading] = useTransition()
  const [asking, setAsking] = useState<VersionEntry | null>(null)
  const [returning, setReturning] = useState(false)

  // The first page comes with the tab and is fresh on every refresh; the older pages the person
  // asked for are kept, and follow the live version, which `isLiveEntry` takes from the view.
  const shown = view.history.entries
  const olderEntries = (older?.entries ?? []).filter(
    (entry) => !shown.some((known) => known.id === entry.id),
  )
  const cursor = older === null ? view.history.nextBeforeVersion : older.nextBeforeVersion

  function loadOlder() {
    if (cursor === null) return
    setLoadFailed(false)
    startLoading(async () => {
      const result = await loadHistoryPageAction(view.venueId, cursor)
      if (!result.ok) {
        setLoadFailed(true)
        return
      }
      setOlder((previous) => ({
        entries: [...(previous?.entries ?? []), ...result.page.entries],
        nextBeforeVersion: result.page.nextBeforeVersion,
      }))
    })
  }

  async function confirmReturn() {
    if (asking === null) return
    setReturning(true)
    try {
      await returnTo(asking.id, asking.version)
    } finally {
      setReturning(false)
      setAsking(null)
    }
  }

  const entries = [...shown, ...olderEntries]
  return (
    <FormSection title={t('title')} description={t('description')}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="history-empty">
          {t('empty')}
        </p>
      ) : (
        <ol className="divide-y" aria-label={t('listLabel')} data-testid="history">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} view={view} busy={busy} onReturn={setAsking} />
          ))}
        </ol>
      )}
      {cursor !== null ? (
        <div>
          <Button type="button" variant="outline" onClick={loadOlder} disabled={loading}>
            {loading ? t('loading') : t('more')}
          </Button>
        </div>
      ) : null}
      {loadFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : null}

      <Dialog open={asking !== null} onOpenChange={(open) => (open ? null : setAsking(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tConfirm('title', { version: asking?.version ?? 0 })}</DialogTitle>
            <DialogDescription>
              {tConfirm('description', { version: asking?.version ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAsking(null)}
              disabled={returning}
            >
              {tConfirm('cancel')}
            </Button>
            <Button
              type="button"
              onClick={confirmReturn}
              disabled={returning}
              data-testid="confirm-return"
            >
              {returning
                ? tConfirm('working')
                : tConfirm('confirm', { version: asking?.version ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormSection>
  )
}
