'use client'

// Settings › Versioning (D96), from the old Versions card: per menu, the version on guests'
// phones and up to two earlier ones to return to, each with when, why, by whom and what it
// changed; held and rejected publishes while they exist. "Return to this version" asks first.
// Older versions are erased by the purge, and the sentence under the list says when.
import { CHANGE_LOG_DAYS, VERSION_PURGE_DAYS, VERSIONS_KEPT } from '@restro/core'
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
import { rollbackAction } from '@/server/publish/actions'
import {
  isLiveEntry,
  isReturnable,
  type VersionCounts,
  type VersionEntry,
  type VersioningMenu,
  type VersioningView,
} from '@/server/publish/view'

import { useActorLabel } from './names'
import { OutcomeNote } from './outcome-note'
import type { Outcome } from './use-publisher'

/** The change counts of a version in words: "1 with a new price, 2 added". */
function CountsText({ counts }: { counts: VersionCounts }) {
  const t = useTranslations('publish.changes.summary')
  const empty = useTranslations('publish.history')('noChange')
  const parts = [
    counts.added > 0 ? t('added', { count: counts.added }) : null,
    counts.hidden > 0 ? t('hidden', { count: counts.hidden }) : null,
    counts.priceChanged > 0 ? t('prices', { count: counts.priceChanged }) : null,
    counts.renamed > 0 ? t('renamed', { count: counts.renamed }) : null,
    counts.otherChanged > 0 ? t('other', { count: counts.otherChanged }) : null,
    counts.areas > 0 ? t('areas', { count: counts.areas }) : null,
  ].filter((part): part is string => part !== null)
  return <>{parts.length > 0 ? parts.join(', ') : empty}</>
}

function EntryRow({
  entry,
  menu,
  timeZone,
  canReturn,
  busy,
  onReturn,
}: {
  entry: VersionEntry
  menu: VersioningMenu
  timeZone: string
  canReturn: boolean
  busy: boolean
  onReturn: (entry: VersionEntry) => void
}) {
  const t = useTranslations('publish.history')
  const tLive = useTranslations('publish.live')
  const moment = useMoment(timeZone)
  const actorLabel = useActorLabel()
  const liveVersion = menu.liveVersion?.version ?? null
  const live = isLiveEntry(entry, liveVersion)
  const returnable = canReturn && isReturnable(entry, liveVersion)
  const returned = live ? (menu.liveVersion?.returned ?? null) : null

  let what: React.ReactNode = null
  if (entry.status === 'held' || entry.status === 'rejected') {
    what = entry.held
      ? t('heldText', { hidden: entry.held.hidden, total: entry.held.previouslyVisible })
      : null
  } else if (entry.counts !== null) {
    what = <CountsText counts={entry.counts} />
  } else if (entry.first) {
    what = t('first')
  }

  return (
    <li
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
      data-testid="history-row"
      data-version={entry.version}
    >
      <div className="grid min-w-0 gap-0.5 sm:flex-1">
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
        <p className="text-sm text-muted-foreground" data-testid="history-meta">
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
        {returned !== null ? (
          <p className="text-sm text-muted-foreground" data-testid="live-returned">
            {tLive('returned', {
              when: moment(returned.at) ?? '',
              who: actorLabel(returned.actor),
            })}
          </p>
        ) : null}
      </div>
      {returnable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
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

function MenuVersions({
  menu,
  view,
  several,
  busy,
  onReturn,
}: {
  menu: VersioningMenu
  view: VersioningView
  several: boolean
  busy: boolean
  onReturn: (entry: VersionEntry) => void
}) {
  const t = useTranslations('publish.history')
  return (
    <div className="grid gap-1" data-testid="versioning-menu" data-menu={menu.menuId}>
      {several ? (
        <h4 className="flex items-center gap-2 text-sm font-medium">
          {menu.name}
          {menu.live ? <Badge variant="outline">{t('liveMenu')}</Badge> : null}
        </h4>
      ) : null}
      {menu.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="history-empty">
          {t('empty')}
        </p>
      ) : (
        <ol className="divide-y" aria-label={t('listLabel')} data-testid="history">
          {menu.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              menu={menu}
              timeZone={view.timeZone}
              canReturn={view.canPublish}
              busy={busy}
              onReturn={onReturn}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

export function VersioningCard({ view }: { view: VersioningView }) {
  const t = useTranslations('publish.history')
  const tConfirm = useTranslations('publish.confirm')
  const [asking, setAsking] = useState<VersionEntry | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [returning, startReturn] = useTransition()
  const several = view.menus.length > 1

  function confirmReturn() {
    const entry = asking
    if (entry === null) return
    setOutcome(null)
    startReturn(async () => {
      const result = await rollbackAction(view.venueId, entry.id)
      setOutcome(
        result.ok
          ? { kind: 'returned', version: entry.version }
          : { kind: 'error', error: result.error },
      )
      setAsking(null)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description', { kept: VERSIONS_KEPT })}>
      <OutcomeNote outcome={outcome} slow={false} onDismiss={() => setOutcome(null)} />
      {view.canPublish ? null : (
        <p className="text-sm text-muted-foreground" data-testid="read-only">
          {t('readOnly')}
        </p>
      )}
      {view.menus.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="history-empty">
          {t('noMenu')}
        </p>
      ) : (
        view.menus.map((menu) => (
          <MenuVersions
            key={menu.menuId}
            menu={menu}
            view={view}
            several={several}
            busy={returning}
            onReturn={setAsking}
          />
        ))
      )}
      <p className="text-xs text-muted-foreground" data-testid="versioning-purge">
        {t('purge', { days: VERSION_PURGE_DAYS, logDays: CHANGE_LOG_DAYS })}
      </p>

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
